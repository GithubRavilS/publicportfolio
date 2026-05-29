import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const OVERRIDE_KEY = "aggregator_url_override";

function fromExtra(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra?.aggregatorUrl as string | undefined;
  return fromExtra?.replace(/\/$/, "");
}

export async function getAggregatorBaseUrl(): Promise<string> {
  try {
    const o = await SecureStore.getItemAsync(OVERRIDE_KEY);
    if (o?.trim()) return o.trim().replace(/\/$/, "");
  } catch {
    /* simulator secure store quirks */
  }
  const env = process.env.EXPO_PUBLIC_AGGREGATOR_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const ex = fromExtra();
  if (ex) return ex;
  return "http://127.0.0.1:8787";
}

export async function setAggregatorUrlOverride(url: string | null): Promise<void> {
  if (!url?.trim()) {
    await SecureStore.deleteItemAsync(OVERRIDE_KEY);
    return;
  }
  await SecureStore.setItemAsync(OVERRIDE_KEY, url.trim().replace(/\/$/, ""));
}

export async function postAggregate(wallet: string): Promise<import("./types").AggregatePayload> {
  const base = await getAggregatorBaseUrl();
  const url = `${base}/v1/aggregate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}
