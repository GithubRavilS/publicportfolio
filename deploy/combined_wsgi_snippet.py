# Вставьте в КОНЕЦ вашего WSGI-файла Crypto Soviet (Web → ссылка на WSGI).
# Путь к боту НЕ ТРОГАЙТЕ — только добавьте блок Portfolio.

import sys

PORTFOLIO_DIR = "/home/Madyan008/Portfolio-tracker"
PORTFOLIO_URL_PREFIX = "/portfolio"

if PORTFOLIO_DIR not in sys.path:
    sys.path.insert(0, PORTFOLIO_DIR)

from wsgi import portfolio_application  # noqa: E402

_original_application = application  # noqa: F821 — application от Crypto Soviet уже объявлен выше


def application(environ, start_response):
    path = environ.get("PATH_INFO", "") or ""
    prefix = PORTFOLIO_URL_PREFIX.rstrip("/")
    if path == prefix or path.startswith(prefix + "/"):
        env = dict(environ)
        env["SCRIPT_NAME"] = prefix
        env["PATH_INFO"] = "/" if path == prefix else path[len(prefix) :]
        return portfolio_application(env, start_response)
    return _original_application(environ, start_response)
