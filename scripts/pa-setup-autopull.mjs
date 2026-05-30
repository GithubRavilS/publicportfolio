#!/usr/bin/env node
/**
 * One-time: register PA scheduled task to git pull from GitHub every hour.
 * Requires .env.pa with PA_API_TOKEN.
 */
import { loadPaEnv, paFetch } from "./pa-env.mjs";

const PULL_CMD = (cfg) =>
  [
    `cd ${cfg.projectDir}`,
    `if [ ! -d .git ]; then git init && git remote add origin ${cfg.gitRemote}; fi`,
    `git fetch origin ${cfg.gitBranch}`,
    `git checkout -B ${cfg.gitBranch} origin/${cfg.gitBranch} 2>/dev/null || git reset --hard origin/${cfg.gitBranch}`,
  ].join(" && ");

async function main() {
  const cfg = loadPaEnv();
  const command = PULL_CMD(cfg);

  const existing = await paFetch(cfg, "/schedule/");
  const dup = (existing || []).find(
    (t) => typeof t.command === "string" && t.command.includes("Portfolio-tracker"),
  );
  if (dup) {
    console.log("Scheduled task already exists:", dup.id, dup.description || "");
    console.log("Command:", dup.command);
    return;
  }

  const created = await paFetch(cfg, "/schedule/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command,
      enabled: "true",
      interval: "hourly",
      hour: "*",
      minute: "5",
      description: "Portfolio Tracker auto-sync from GitHub",
    }),
  });

  console.log("Created scheduled task:", created);
  console.log("GitHub push → PA within ~1 hour (no manual upload).");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
