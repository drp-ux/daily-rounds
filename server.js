const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

// ─── CORS — allow chrome-extension and browser origins ────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "patients.json");

// Load patients from disk
function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {}
  return { patients: [], updatedAt: null };
}

// Save patients to disk
function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), "utf8");
}

// GET /api/patients — return current list
app.get("/api/patients", (req, res) => {
  res.json(load());
});

// POST /api/patients — replace full list (import)
app.post("/api/patients", (req, res) => {
  const { patients } = req.body;
  if (!Array.isArray(patients)) return res.status(400).json({ error: "patients must be array" });
  const data = { patients, updatedAt: Date.now() };
  save(data);
  res.json({ ok: true, count: patients.length });
});

// PATCH /api/patients/:id/note — update a single patient's note
app.patch("/api/patients/:id/note", (req, res) => {
  const { note } = req.body;
  const data = load();
  const p = data.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  p.note = note;
  p.updatedAt = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  data.updatedAt = Date.now();
  save(data);
  res.json({ ok: true });
});

// DELETE /api/patients — clear all
app.delete("/api/patients", (req, res) => {
  save({ patients: [], updatedAt: Date.now() });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rounds app running on port ${PORT}`));
