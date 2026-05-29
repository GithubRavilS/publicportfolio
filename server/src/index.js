import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { aggregateWallet } from "./aggregate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "portfolio-aggregator" });
});

app.post("/v1/aggregate", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    if (!wallet) {
      return res.status(400).json({ error: "wallet required" });
    }
    const keys = {
      debank: process.env.DEBANK_ACCESS_KEY || "",
      krystal: process.env.KRYSTAL_CLOUD_API_KEY || "",
      jupiter: process.env.JUPITER_API_KEY || "",
    };
    const payload = await aggregateWallet(wallet, keys);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "aggregate failed" });
  }
});

app.use(express.static(webDist));
app.get(/^\/(?!v1\/|health).*/, (_req, res, next) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Aggregator listening on http://127.0.0.1:${port}`);
  console.log(`Web UI: http://127.0.0.1:${port} (after npm run build in web/)`);
});
