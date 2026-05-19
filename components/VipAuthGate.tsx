"use client";

import { ReactNode, useEffect, useState } from "react";

const BACKEND = (
  process.env.NEXT_PUBLIC_VIP_AUTH_BACKEND || "https://cry-Maden008.pythonanywhere.com"
).replace(/\/$/, "");
const STORAGE_KEY = "defilabs_vip_jwt";
const LEGACY_KEYS = ["defilabs_nav_jwt"];

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  try {
    let t = localStorage.getItem(STORAGE_KEY) || "";
    if (t) return t;
    const ss = sessionStorage.getItem(STORAGE_KEY) || "";
    if (ss) {
      localStorage.setItem(STORAGE_KEY, ss);
      sessionStorage.removeItem(STORAGE_KEY);
      return ss;
    }
    for (const lk of LEGACY_KEYS) {
      const leg = localStorage.getItem(lk) || sessionStorage.getItem(lk) || "";
      if (leg) {
        localStorage.setItem(STORAGE_KEY, leg);
        localStorage.removeItem(lk);
        sessionStorage.removeItem(lk);
        return leg;
      }
    }
    return "";
  } catch {
    return "";
  }
}

function writeStoredToken(token: string) {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      for (const lk of LEGACY_KEYS) {
        localStorage.removeItem(lk);
        sessionStorage.removeItem(lk);
      }
    }
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function normalizePassword(raw: string) {
  return String(raw || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200F\u2028\u2029]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\r\n]+/g, "")
    .replace(/[：﹕]/g, ":")
    .replace(/\s+/g, "")
    .trim();
}

function authRequired() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return (
    h.includes("publicportfolio") ||
    h.includes("vercel.app") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
}

async function sessionCheck(token: string) {
  const r = await fetch(`${BACKEND}/nav-api/session`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token ? { token } : {}),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.ok === true;
}

async function loginRequest(password: string) {
  const r = await fetch(`${BACKEND}/nav-api/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok === true, j };
}

export function VipAuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [err, setErr] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authRequired()) {
      setReady(true);
      return;
    }
    const token = readStoredToken();
    sessionCheck(token)
      .then((ok) => {
        if (ok) {
          setShowGate(false);
          setReady(true);
        } else {
          writeStoredToken("");
          setShowGate(true);
        }
      })
      .catch(() => {
        if (readStoredToken()) {
          setShowGate(false);
          setReady(true);
          return;
        }
        setShowGate(true);
      });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const p = normalizePassword(pwd);
    if (!p) return;
    setBusy(true);
    try {
      const x = await loginRequest(p);
      if (x.ok && x.j?.token) {
        writeStoredToken(String(x.j.token));
        setShowGate(false);
        setReady(true);
        setPwd("");
        return;
      }
      if (x.ok) {
        setErr("Обновите API на PythonAnywhere (нет token в ответе).");
        return;
      }
      const code = x.j?.error ? String(x.j.error) : "";
      if (code === "wrong_password") setErr("Пароль не подходит. Запросите новый в боте.");
      else if (code === "expired") setErr("Срок VIP истёк.");
      else setErr("Не удалось войти.");
    } catch {
      setErr("Нет связи с сервером.");
    } finally {
      setBusy(false);
    }
  }

  if (!authRequired()) return <>{children}</>;

  if (!ready && !showGate) {
    return null;
  }

  return (
    <>
      {showGate ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(6,8,20,0.88)",
          }}
        >
          <form
            onSubmit={onSubmit}
            style={{
              width: "100%",
              maxWidth: 420,
              padding: 28,
              borderRadius: 16,
              border: "1px solid rgba(79,163,255,0.35)",
              background: "linear-gradient(145deg,#1a1f3a,#0a0e27)",
              color: "#e8eaf6",
            }}
          >
            <h2 style={{ marginBottom: 10 }}>Доступ DeFi Labs VIP</h2>
            <p style={{ fontSize: 13, color: "#9aa3c7", marginBottom: 16 }}>
              Пароль из Telegram: DeFi Labs VIP → «Получить пароль». Один пароль для всей экосистемы.
            </p>
            {err ? (
              <p style={{ color: "#f5a5a0", fontSize: 12, marginBottom: 8 }}>{err}</p>
            ) : null}
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="NAV:… целиком"
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: 14,
                marginBottom: 12,
                borderRadius: 10,
                border: "1px solid #3a4466",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                fontFamily: "monospace",
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: 14,
                border: "none",
                borderRadius: 10,
                background: "#4fa3ff",
                color: "#fff",
                fontWeight: 700,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Войти
            </button>
          </form>
        </div>
      ) : null}
      {ready ? children : null}
    </>
  );
}
