import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const SHEETS_PROXY_URL =
  process.env.LP_SHEETS_PROXY_URL ||
  "https://defilabsvipnavigator.vercel.app/api/public-portfolio-lp";

function colName(idx) {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function parseServiceAccountJson(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/^\uFEFF/, "").trim();
  if (!s) return null;
  s = s.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON(_B64)?\s*=\s*/i, "");
  const attempts = [s];
  if (!s.startsWith("{")) attempts.push(`{${s}}`);
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function getCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (b64) {
    try {
      return parseServiceAccountJson(Buffer.from(String(b64).trim(), "base64").toString("utf8"));
    } catch {
      return parseServiceAccountJson(String(b64).trim());
    }
  }
  return parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

async function loadFromSheetsApi(sheetId, sheetName) {
  const credentials = getCredentials();
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  const sheets = google.sheets({ version: "v4", auth });
  const range = `'${sheetName.replace(/'/g, "''")}'!A:Z`;
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return data.values || [];
}

async function loadViaProxy(req) {
  const qs = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const res = await fetch(`${SHEETS_PROXY_URL}${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `proxy HTTP ${res.status}`);
  }
  return res.json();
}

function buildPayload(values) {
  if (!values.length) {
    return { headers: [], rows: [] };
  }
  const headers = values[0].map((h) => String(h ?? "").trim());
  const rows = values.slice(1).map((raw) => {
    const row = headers.map((_, i) => {
      const val = i < raw.length ? raw[i] : "";
      if (val == null) return "";
      if (typeof val === "number") return val;
      return String(val);
    });
    const letters = {};
    row.forEach((v, i) => {
      letters[colName(i)] = v;
    });
    return { cells: row, letters };
  });
  return { headers, rows };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const sheetId = String(req.query.sheetId || req.query.id || "").trim();
  const sheetName = String(req.query.sheetName || req.query.name || "Public portfolio").trim();
  if (!sheetId) {
    res.status(400).json({ error: "missing_sheet_id" });
    return;
  }

  try {
    let payload;
    const values = await loadFromSheetsApi(sheetId, sheetName);
    if (values) {
      payload = { ...buildPayload(values), source: "google_sheets_api_v4" };
    } else {
      const proxied = await loadViaProxy(req);
      payload = {
        headers: proxied.headers || [],
        rows: proxied.rows || [],
        source: proxied.source || "google_sheets_api_v4_proxy",
      };
    }
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "sheet_fetch_failed", message: String(err?.message || err) });
  }
}
