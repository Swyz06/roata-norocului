const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET = process.env.SECRET;

if (!DATABASE_URL || !ADMIN_PASSWORD || !SECRET) {
  console.error("Lipsesc variabilele DATABASE_URL, ADMIN_PASSWORD sau SECRET.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

const defaults = [
  ["Voucher 50 lei", 1], ["20% reducere", 2], ["10% reducere", 3],
  ["Produs gratuit", 1], ["Voucher 20 lei", 2],
  ["Mai încearcă data viitoare", 4], ["Transport gratuit", 2], ["Surpriză 🎁", 1]
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prizes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS participants (
      id BIGSERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      prize TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const c = await pool.query("SELECT COUNT(*)::int AS count FROM prizes");
  if (c.rows[0].count === 0) {
    for (const [name, weight] of defaults) {
      await pool.query("INSERT INTO prizes(name, weight) VALUES($1,$2)", [name, weight]);
    }
  }
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function adminOk(req) {
  return req.headers["x-admin-token"] === sign(ADMIN_PASSWORD);
}

function participantToken(req, res) {
  let token = req.cookies.wheel_id;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie("wheel_id", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 365,
      path: "/"
    });
  }
  return token;
}

async function choosePrize() {
  const { rows } = await pool.query(
    "SELECT id, name, weight FROM prizes WHERE active = TRUE ORDER BY id"
  );
  if (!rows.length) throw new Error("Nu există premii active.");
  const total = rows.reduce((sum, p) => sum + Math.max(1, p.weight), 0);
  let n = Math.random() * total;
  for (const p of rows) {
    n -= Math.max(1, p.weight);
    if (n <= 0) return p;
  }
  return rows[rows.length - 1];
}

app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const playLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

app.get("/api/prizes", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM prizes WHERE active = TRUE ORDER BY id"
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Eroare server." }); }
});

app.get("/api/me", async (req, res) => {
  try {
    const token = req.cookies.wheel_id;
    if (!token) return res.json({ played: false });
    const { rows } = await pool.query(
      "SELECT first_name AS name, prize, created_at AS \"createdAt\" FROM participants WHERE token=$1",
      [token]
    );
    res.json({ played: !!rows.length, participant: rows[0] || null });
  } catch { res.status(500).json({ error: "Eroare server." }); }
});

app.post("/api/play", playLimiter, async (req, res) => {
  try {
    const firstName = String(req.body.firstName || "").trim().replace(/\s+/g, " ");
    if (!firstName || firstName.length > 30) {
      return res.status(400).json({ error: "Prenume invalid." });
    }

    const token = participantToken(req, res);
    const existing = await pool.query(
      "SELECT first_name AS name, prize, created_at AS \"createdAt\" FROM participants WHERE token=$1",
      [token]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        error: "Ai participat deja.",
        existing: existing.rows[0]
      });
    }

    const prize = await choosePrize();

    // Token-ul este UNIQUE în DB: chiar dacă două cereri ajung simultan,
    // doar una poate crea participarea.
    const result = await pool.query(
      `INSERT INTO participants(token, first_name, prize)
       VALUES($1,$2,$3)
       ON CONFLICT(token) DO NOTHING
       RETURNING first_name AS "firstName", prize`,
      [token, firstName, prize.name]
    );

    if (!result.rows.length) {
      return res.status(409).json({ error: "Ai participat deja." });
    }

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Nu s-a putut înregistra participarea." });
  }
});

app.get("/api/winners", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT first_name AS name, prize, created_at AS "createdAt"
       FROM participants ORDER BY id DESC LIMIT 100`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Eroare server." }); }
});

app.post("/api/admin/login", rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20,
  standardHeaders: "draft-8", legacyHeaders: false
}), (req, res) => {
  if (String(req.body.password || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Parolă incorectă." });
  }
  res.json({ token: sign(ADMIN_PASSWORD) });
});

app.use("/api/admin", (req, res, next) => {
  if (!adminOk(req)) return res.status(401).json({ error: "Neautorizat." });
  next();
});

app.get("/api/admin/prizes", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id,name,weight,active FROM prizes ORDER BY id"
  );
  res.json(rows);
});

app.post("/api/admin/prizes", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const weight = Math.max(1, Math.floor(Number(req.body.weight) || 1));
  if (!name || name.length > 100) return res.status(400).json({ error: "Nume invalid." });
  const { rows } = await pool.query(
    "INSERT INTO prizes(name,weight,active) VALUES($1,$2,TRUE) RETURNING id",
    [name, weight]
  );
  res.json(rows[0]);
});

app.put("/api/admin/prizes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const weight = Math.max(1, Math.floor(Number(req.body.weight) || 1));
  const active = !!req.body.active;
  await pool.query(
    "UPDATE prizes SET name=$1,weight=$2,active=$3 WHERE id=$4",
    [name, weight, active, id]
  );
  res.json({ ok: true });
});

app.delete("/api/admin/prizes/:id", async (req, res) => {
  await pool.query("DELETE FROM prizes WHERE id=$1", [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get("/api/admin/winners", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id,first_name AS name,prize,created_at AS "createdAt"
     FROM participants ORDER BY id DESC`
  );
  res.json(rows);
});

app.delete("/api/admin/winners", async (_req, res) => {
  await pool.query("DELETE FROM participants");
  res.json({ ok: true });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Site pornit pe portul ${PORT}`)))
  .catch(err => { console.error(err); process.exit(1); });
