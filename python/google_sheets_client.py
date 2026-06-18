"""Google Sheets API v4 — читает вычисленные значения формул (в отличие от gviz CSV)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ("https://www.googleapis.com/auth/spreadsheets.readonly",)


def excel_col_name(idx: int) -> str:
    n = idx + 1
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def _service_account_path(config: dict) -> Path | None:
    raw = str(
        config.get("google_service_account_file") or "python/google-service-account.json"
    ).strip()
    path = Path(raw)
    if path.is_file():
        return path
    alt = Path("python") / path.name
    return alt if alt.is_file() else None


def get_sheets_service(config: dict) -> Any | None:
    path = _service_account_path(config)
    if not path:
        return None
    creds = service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def load_sheet_values_as_row_dicts(
    sheet_id: str,
    sheet_name: str,
    config: dict,
    *,
    last_column: str = "Z",
) -> list[dict[str, str]]:
    """Возвращает строки листа с вычисленными значениями ячеек (формулы → результат)."""
    if not sheet_id or not sheet_name:
        return []
    service = get_sheets_service(config)
    if not service:
        return []
    range_name = f"'{sheet_name}'!A:{last_column}"
    result = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=sheet_id,
            range=range_name,
            valueRenderOption="UNFORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING",
        )
        .execute()
    )
    values = result.get("values") or []
    if len(values) < 2:
        return []
    headers = [str(h or "").strip() for h in values[0]]
    out: list[dict[str, str]] = []
    for raw_row in values[1:]:
        item: dict[str, str] = {}
        for i, header in enumerate(headers):
            col = excel_col_name(i)
            val = raw_row[i] if i < len(raw_row) else ""
            if val is None:
                text = ""
            elif isinstance(val, (int, float)):
                text = str(val)
            else:
                text = str(val).strip()
            item[col] = text
            if header:
                item[header] = text
        if any(str(v).strip() for v in item.values()):
            out.append(item)
    return out
