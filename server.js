const express = require("express");
const path = require("path");
const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Upstash Redis ─────────────────────────────────────────────────────────────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "daily_rounds_v2";

function headers() {
  return { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" };
}

// GET value from Redis — returns parsed object or null
async function redisGet() {
  const r = await fetch(`${REDIS_URL}/get/${KEY}`, { headers: headers() });
  const j = await r.json();
  if (!j.result) return null;
  const parsed = JSON.parse(j.result);
  // Guard against double-encoded legacy data
  if (typeof parsed === "string") return JSON.parse(parsed);
  return parsed;
}

// SET value in Redis — value is stringified once before sending
async function redisSet(data) {
  // Upstash direct command endpoint: POST / with body ["SET", key, value]
  const r = await fetch(`${REDIS_URL}/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(["SET", KEY, JSON.stringify(data)])
  });
  const j = await r.json();
  if (j.error) throw new Error("Redis SET failed: " + j.error);
}

// ─── In-memory fallback ────────────────────────────────────────────────────────
let mem = { patients: [], updatedAt: null };

async function load() {
  if (!REDIS_URL) return mem;
  try {
    const data = await redisGet();
    if (data && Array.isArray(data.patients)) { mem = data; return data; }
  } catch(e) { console.error("Redis load error:", e.message); }
  return mem;
}

async function save(data) {
  mem = data;
  if (!REDIS_URL) return;
  try { await redisSet(data); }
  catch(e) { console.error("Redis save error:", e.message); }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

app.get("/api/patients", async (req, res) => {
  try { res.json(await load()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/patients", async (req, res) => {
  try {
    const { patients } = req.body;
    if (!Array.isArray(patients)) return res.status(400).json({ error: "patients must be array" });
    const data = { patients, updatedAt: Date.now() };
    await save(data);
    res.json({ ok: true, count: patients.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/patients/:id/note", async (req, res) => {
  try {
    const data = await load();
    const p = data.patients.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "not found" });
    p.note = req.body.note;
    p.updatedAt = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    data.updatedAt = Date.now();
    await save(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/patients/:id/seen", async (req, res) => {
  try {
    const data = await load();
    const p = data.patients.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "not found" });
    p.seen = req.body.seen;
    data.updatedAt = Date.now();
    await save(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/patients", async (req, res) => {
  try {
    await save({ patients: [], updatedAt: Date.now() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Health check — also shows what's in Redis right now
app.get("/api/health", async (req, res) => {
  if (!REDIS_URL) return res.json({ ok: true, storage: "memory-only" });
  try {
    const data = await redisGet();
    res.json({
      ok: true,
      storage: "upstash",
      patients: data?.patients?.length ?? "no data",
      updatedAt: data?.updatedAt ?? null
    });
  } catch(e) {
    res.json({ ok: false, storage: "upstash-error", error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Daily Rounds :${PORT} — ${REDIS_URL ? "Upstash" : "memory"}`));
