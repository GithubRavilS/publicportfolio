import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

export const PA_DEFAULTS = {
  host: "www.pythonanywhere.com",
  username: "Maden008",
  domain: "cry-maden008.pythonanywhere.com",
  projectDir: "/home/Maden008/Portfolio-tracker",
  gitBranch: "portfolio-tracker",
  gitRemote: "https://github.com/GithubRavilS/publicportfolio.git",
};

/** @returns {{ host: string, username: string, token: string, domain: string, projectDir: string, gitBranch: string, gitRemote: string }} */
export function loadPaEnv() {
  const envPath = resolve(ROOT, ".env.pa");
  const file = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const fromFile = Object.fromEntries(
    file
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : [];
      })
      .filter((pair) => pair.length === 2),
  );

  const cfg = { ...PA_DEFAULTS, ...fromFile };
  const token = process.env.PA_API_TOKEN || cfg.PA_API_TOKEN || cfg.token;
  if (!token) {
    console.error(
      "Missing PA API token. Copy .env.pa.example → .env.pa and set PA_API_TOKEN.\n" +
        "Get token: pythonanywhere.com → Account → API token.",
    );
    process.exit(1);
  }

  return {
    host: cfg.PA_HOST || cfg.host || PA_DEFAULTS.host,
    username: cfg.PA_USERNAME || cfg.username || PA_DEFAULTS.username,
    token,
    domain: cfg.PA_DOMAIN || cfg.domain || PA_DEFAULTS.domain,
    projectDir: cfg.PA_PROJECT_DIR || cfg.projectDir || PA_DEFAULTS.projectDir,
    gitBranch: cfg.PA_GIT_BRANCH || cfg.gitBranch || PA_DEFAULTS.gitBranch,
    gitRemote: cfg.PA_GIT_REMOTE || cfg.gitRemote || PA_DEFAULTS.gitRemote,
  };
}

export function paBase(cfg) {
  return `https://${cfg.host}/api/v0/user/${cfg.username}`;
}

export async function paFetch(cfg, path, { method = "GET", body, headers = {} } = {}) {
  const url = `${paBase(cfg)}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Token ${cfg.token}`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`PA API ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

export async function reloadWebapp(cfg) {
  return paFetch(cfg, `/webapps/${cfg.domain}/reload/`, { method: "POST" });
}
