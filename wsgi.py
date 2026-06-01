"""
WSGI для PythonAnywhere (и любого хостинга с WSGI).
В панели Web → WSGI configuration file укажите этот файл и application.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server as srv  # noqa: E402


def _ensure_node_on_path() -> None:
    """uWSGI не загружает nvm из .bashrc — добавляем node в PATH."""
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if not nvm_root.is_dir():
        return
    for bin_dir in sorted(nvm_root.glob("*/bin"), reverse=True):
        p = str(bin_dir)
        if bin_dir.joinpath("node").is_file():
            os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")
            break


_ensure_node_on_path()

try:
    from werkzeug.utils import send_from_directory
    from werkzeug.wrappers import Request, Response
except ImportError as e:
    raise ImportError("Установите Flask/Werkzeug на PythonAnywhere: pip install werkzeug") from e


def _api_log(msg: str) -> None:
    try:
        p = ROOT / ".cache" / "api-debug.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


def _json_response(data: dict, status: int = 200) -> Response:
    return Response(
        json.dumps(data, ensure_ascii=False),
        status=status,
        mimetype="application/json; charset=utf-8",
        headers={"Cache-Control": "no-store", "X-Portfolio-Tracker": "1"},
    )


def _serve_static(environ, start_response, rel_path: str):
    """Werkzeug 2.1 (PA) и 3.x — разный API send_from_directory."""
    root = str(ROOT)
    try:
        return send_from_directory(ROOT, rel_path)(environ, start_response)
    except TypeError:
        resp = send_from_directory(root, rel_path, environ)
        return resp(environ, start_response)


def _handle_portfolio(qs: dict) -> Response:
    wallet = (qs.get("wallet") or [""])[0].strip()
    _api_log(f"portfolio wallet={wallet[:10]}...")
    show_small = (qs.get("dust") or ["0"])[0].lower() in ("1", "true", "yes")
    quick = (qs.get("quick") or ["0"])[0].lower() in ("1", "true", "yes")
    refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
    source = (qs.get("source") or ["rpc"])[0].lower()
    use_onchain_only = source in ("onchain", "chain")
    use_aggregator = source in ("auto", "aggregator", "debank", "hybrid", "")
    try:
        if source == "rpc":
            portfolio = srv.fetch_rpc_portfolio(
                wallet, refresh=refresh, show_small=show_small, quick=quick
            )
            return _json_response(
                {
                    "ok": True,
                    "portfolio": portfolio,
                    "cached": bool(portfolio.get("fromCache")),
                    "source": "rpc",
                    "scanMs": portfolio.get("scanMs"),
                }
            )

        if use_aggregator:
            portfolio = srv.fetch_aggregator_portfolio(
                wallet, quick=quick, refresh=refresh, show_small=show_small
            )
            src = portfolio.get("source") or "aggregator"
            return _json_response(
                {
                    "ok": True,
                    "portfolio": portfolio,
                    "cached": bool(portfolio.get("fromCache")),
                    "source": src,
                }
            )

        if use_onchain_only and not quick:
            if not refresh:
                cached = srv.load_onchain_portfolio_cache(wallet)
                if cached and (cached.get("totalUsd") or 0) > 0:
                    cached = dict(cached)
                    cached["fromCache"] = True
                    return _json_response(
                        {
                            "ok": True,
                            "portfolio": cached,
                            "cached": True,
                            "source": "onchain",
                        }
                    )
            force_onchain = refresh or (qs.get("refreshOnchain") or ["0"])[0].lower() in (
                "1",
                "true",
                "yes",
            )
            portfolio = srv.build_hybrid_portfolio(
                wallet,
                refresh=force_onchain,
                show_small=show_small,
                force_onchain=force_onchain,
            )
            return _json_response(
                {"ok": True, "portfolio": portfolio, "cached": False, "source": "onchain"}
            )

        if quick and use_onchain_only:
            try:
                portfolio = srv.run_onchain_portfolio(wallet, quick=True)
                return _json_response(
                    {
                        "ok": True,
                        "portfolio": portfolio,
                        "cached": False,
                        "source": "onchain",
                        "partial": True,
                    }
                )
            except Exception as ex:
                _api_log(f"onchain quick failed: {ex!s}")

        if source == "debank" and not refresh and not quick:
            cached = srv.load_portfolio_cache(wallet)
            if cached:
                cached = dict(cached)
                cached["fromCache"] = True
                cached["partial"] = False
                return _json_response({"ok": True, "portfolio": cached, "cached": True})

        if quick:
            main_text = srv.fetch_main_profile_quick(wallet)
            if not main_text:
                raise ValueError("FETCH_FAILED")
            portfolio = srv.parse_full_portfolio(main_text, {}, show_small)
            portfolio["partial"] = True
        else:
            main_text, chain_texts = srv.fetch_full_portfolio_text(wallet)
            if not main_text and not chain_texts:
                raise ValueError("FETCH_FAILED")
            portfolio = srv.parse_full_portfolio(main_text, chain_texts, show_small)
            portfolio["partial"] = False
            portfolio["fromCache"] = False
            srv.save_portfolio_cache(wallet, portfolio)
        _api_log(f"portfolio ok totalUsd={portfolio.get('totalUsd')}")
        return _json_response({"ok": True, "portfolio": portfolio, "cached": False})
    except ValueError as e:
        code = str(e).split(":")[0]
        _api_log(f"portfolio ValueError {e}")
        status = 400 if code == "INVALID_WALLET" else 502
        return _json_response({"ok": False, "error": code}, status=status)
    except Exception as e:
        _api_log(f"portfolio Exception {e}\n{traceback.format_exc()}")
        err = str(e).split(":")[0] if str(e) else "FETCH_FAILED"
        if "PARSE_FAILED" in str(e):
            err = "PARSE_FAILED"
        return _json_response({"ok": False, "error": err}, status=502)


def _handle_history(qs: dict) -> Response:
    wallet = (qs.get("wallet") or [""])[0].strip()
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
        return _json_response({"ok": False, "error": "INVALID_WALLET"}, status=400)
    try:
        series = srv.load_history_cache(wallet)
        if not series:
            portfolio = srv.load_portfolio_cache(wallet)
            if not portfolio:
                main_text = srv.fetch_main_profile_quick(wallet)
                if not main_text:
                    raise ValueError("NO_PORTFOLIO")
                portfolio = srv.parse_full_portfolio(main_text, {}, False)
            series = srv.build_portfolio_history(portfolio)
            if not series:
                series = srv.flat_history_fallback(portfolio)
            if series:
                srv.save_history_cache(wallet, series)
        return _json_response({"ok": True, "series": series or [], "note": "anchored_to_total_v2"})
    except Exception:
        return _json_response({"ok": False, "error": "HISTORY_FAILED"}, status=502)


def _handle_revert(qs: dict) -> Response:
    wallet = (qs.get("wallet") or [""])[0].strip()
    refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
        return _json_response({"ok": False, "error": "INVALID_WALLET"}, status=400)
    try:
        onchain_only = (qs.get("onchainOnly") or ["0"])[0].lower() in ("1", "true", "yes")
        return _json_response(
            srv.build_revert_api_payload(wallet, refresh=refresh, onchain_only=onchain_only)
        )
    except Exception as ex:
        _api_log(f"revert handler: {ex!s}")
        stale = srv.load_revert_cache(wallet, allow_stale=True) or []
        if stale:
            return _json_response(
                {
                    "ok": True,
                    "positions": stale,
                    "count": len(stale),
                    "cached": True,
                    "stale": True,
                    "warning": "REVERT_FETCH_FAILED",
                    "onchainEnriched": 0,
                    "source": "revert",
                }
            )
        return _json_response({"ok": False, "error": "REVERT_FAILED", "positions": []}, status=502)


def _handle_onchain_lp(qs: dict) -> Response:
    wallet = (qs.get("wallet") or [""])[0].strip()
    refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
    enrich = (qs.get("enrich") or ["0"])[0].lower() in ("1", "true", "yes")
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
        return _json_response({"ok": False, "error": "INVALID_WALLET"}, status=400)
    try:
        oc = None if refresh else srv.load_onchain_cache(wallet)
        if oc is None:
            rev = srv.load_revert_cache(wallet) if enrich else []
            oc = srv.run_onchain_enrich(wallet, rev or [])
            if oc.get("onchain"):
                srv.save_onchain_cache(wallet, oc)
        return _json_response(
            {
                "ok": True,
                "wallet": wallet.lower(),
                "onchain": oc.get("onchain") or [],
                "positions": oc.get("positions") if enrich else oc.get("onchain"),
                "count": oc.get("count") or len(oc.get("onchain") or []),
                "cached": not refresh,
                "source": "onchain-rpc",
            }
        )
    except Exception as ex:
        _api_log(f"onchain lp: {ex!s}")
        return _json_response({"ok": False, "error": "ONCHAIN_FAILED", "onchain": []}, status=502)


def portfolio_application(environ, start_response):  # noqa: N802
    request = Request(environ)
    path = request.path or "/"
    qs = urllib.parse.parse_qs(request.query_string.decode() if request.query_string else "")

    if path == "/api/health":
        return _json_response({"ok": True, "app": "portfolio-tracker"})(environ, start_response)

    if path == "/api/diag":
        cfg = ROOT / "config.json"
        return _json_response(
            {
                "ok": True,
                "node": srv.NODE_BIN,
                "node_ok": os.path.isfile(srv.NODE_BIN),
                "config_ok": cfg.is_file(),
                "debank_api": bool(srv.load_debank_access_key()),
                "wsgi": "portfolio_v6_rpc",
                "defaultSource": "rpc",
                "schema": getattr(srv, "ONCHAIN_PORTFOLIO_SCHEMA", 13),
            }
        )(environ, start_response)

    if path == "/api/cache/clear":
        wallet = (qs.get("wallet") or [""])[0].strip().lower()
        cleared = []
        if re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            for fn, label in [
                (srv._cache_path(wallet), "portfolio"),
                (srv._onchain_portfolio_cache_path(wallet), "onchain-portfolio"),
                (srv._revert_cache_path(wallet), "revert"),
            ]:
                try:
                    if fn.exists():
                        fn.unlink()
                        cleared.append(label)
                except OSError:
                    pass
        return _json_response({"ok": True, "wallet": wallet, "cleared": cleared})

    if path == "/api/portfolio":
        return _handle_portfolio(qs)(environ, start_response)

    if path == "/api/history":
        return _handle_history(qs)(environ, start_response)

    if path == "/api/revert":
        return _handle_revert(qs)(environ, start_response)

    if path == "/api/onchain/lp":
        return _handle_onchain_lp(qs)(environ, start_response)

    if path in ("/", ""):
        return _serve_static(environ, start_response, "index.html")

    rel = path.lstrip("/")
    target = ROOT / rel
    if target.is_file():
        return _serve_static(environ, start_response, rel)

    return Response("Not Found", status=404)(environ, start_response)


application = portfolio_application  # отдельный сайт; на PA с ботом — combined_wsgi.py


def mount_at(prefix: str = "/portfolio"):
    """Обёртка для общего WSGI: Crypto Soviet + Portfolio на подпути."""
    pre = prefix.rstrip("/") or "/portfolio"

    def mounted(environ, start_response):
        path = environ.get("PATH_INFO", "") or ""
        if path == pre or path.startswith(pre + "/"):
            environ = dict(environ)
            environ["SCRIPT_NAME"] = pre
            if path == pre:
                environ["PATH_INFO"] = "/"
            else:
                environ["PATH_INFO"] = path[len(pre) :] or "/"
            return portfolio_application(environ, start_response)
        return None

    return mounted
