/**
 * Загрузка data/llama-universe.json (генерируется build:llama).
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dir, "../data/llama-universe.json");

let cache = null;

export function loadLlamaUniverse() {
  if (cache) return cache;
  if (!existsSync(PATH)) return null;
  try {
    cache = JSON.parse(readFileSync(PATH, "utf8"));
    return cache;
  } catch {
    return null;
  }
}

export function gapProtocols(limit = 30) {
  const u = loadLlamaUniverse();
  if (!u) return [];
  const all = [...(u.gaps?.lending || []), ...(u.gaps?.dex || []), ...(u.gaps?.other || [])];
  return all.sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, limit);
}
