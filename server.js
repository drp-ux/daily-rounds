const express = require("express");
const path = require("path");
const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Upstash Redis REST helpers ───────────────────────────────────────────────
// Env vars set in Render dashboard:
//   UPSTASH_REDIS_REST_URL  — e.g. https://xxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN — your token

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "daily_rounds_patients";

async function redisGet() {
  if (!REDIS_URL) return null;
  const res = await fetch(`${REDIS_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const json = await res.json();
  // Upstash returns { result: "stringified-value" } or { result: null }
  if (!json.result) return null;
  return JSON.parse(json.result);
}

async function redisSet(data) {
  if (!REDIS_URL) return;
  // Upstash SET via REST: POST /{url}/set/{key}  body = { value }
  // or use the pipeline-style URL: /set/key/value (but value must be encoded)
  // Easiest: use the command endpoint
  await fetch(`${REDIS_URL}/set/${KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(JSON.stringify(data)) // double-stringify: Upstash stores raw string
  });
}

// ─── Fallback in-memory store (used if Upstash env vars not set) ──────────────
// This keeps data alive as long as the Render instance is running,
// and degrades gracefully without crashing.
let memStore = { patients: [], updatedAt: null };

async function load() {
  try {
    const data = await redisGet();
    if (data) return data;
  } catch(e) {
    console.error("Redis read error:", e.message);
  }
  return memStore;
}

async function save(data) {
  memStore = data;
  try {
    await redisSet(data);
  } catch(e) {
    console.error("Redis write error:", e.message);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/patients", async (req, res) => {
  try {
    res.json(await load());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/patients", async (req, res) => {
  const { patients } = req.body;
  if (!Array.isArray(patients)) return res.status(400).json({ error: "patients must be array" });
  const data = { patients, updatedAt: Date.now() };
  await save(data);
  res.json({ ok: true, count: patients.length });
});

app.patch("/api/patients/:id/note", async (req, res) => {
  const { note } = req.body;
  const data = await load();
  const p = data.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  p.note = note;
  p.updatedAt = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  data.updatedAt = Date.now();
  await save(data);
  res.json({ ok: true });
});

app.patch("/api/patients/:id/seen", async (req, res) => {
  const { seen } = req.body;
  const data = await load();
  const p = data.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  p.seen = seen;
  data.updatedAt = Date.now();
  await save(data);
  res.json({ ok: true });
});

app.delete("/api/patients", async (req, res) => {
  await save({ patients: [], updatedAt: Date.now() });
  res.json({ ok: true });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const storage = REDIS_URL ? "upstash" : "memory-only";
  res.json({ ok: true, storage });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Daily Rounds running on port ${PORT} — storage: ${REDIS_URL ? "Upstash Redis" : "memory only (set UPSTASH env vars)"}`));
