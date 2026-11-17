// What to Watch: pieni palvelin ilman riippuvuuksia (Node 20 tai uudempi).
//  - tarjoaa sivun tiedostoista public/
//  - POST /api/suggest: ajaa Claude-agentin ja palauttaa vain tarkistetut ehdotukset (NDJSON-virtana)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suggest, AgentError } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

/* ---------- .env-tiedoston luku (valinnainen) ---------- */
try {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
} catch (e) {
  console.error("Could not read .env:", e.message);
}

const PORT = Number(process.env.PORT) || 3000;
const RATE_PER_10MIN = Number(process.env.RATE_PER_10MIN) || 6;   // hakuja per IP / 10 min
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 500;       // hakuja yhteensä / vrk

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};
const SECURITY = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

/* ---------- syötteen tarkistus ---------- */
const LANGS = ["fi", "en", "sv", "de", "es", "fr"];
const KINDS = ["both", "film", "series"];
const RATES = [0, 7, 12, 16, 18];
const MOODS = ["Thrilling", "Funny", "Touching", "Calm", "Crime", "Sci-fi", "Horror", "Romance", "Documentary", "Animation", "With family", "Short", "True story"];
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

function parseInput(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "body" };
  const region = str(b.region, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) return { error: "region" };
  const age = Number(b.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) return { error: "age" };
  const services = (Array.isArray(b.services) ? b.services : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 20);
  if (!services.length) return { error: "services" };
  let rateMin = null, rateMax = null;
  if (b.rateMin != null || b.rateMax != null) {
    if (!RATES.includes(b.rateMin) || !RATES.includes(b.rateMax) || b.rateMin > b.rateMax) return { error: "rate" };
    rateMin = b.rateMin; rateMax = b.rateMax;
  }
  let regionName = region;
  try { regionName = new Intl.DisplayNames(["en"], { type: "region" }).of(region) || region; } catch { /* käytetään koodia */ }
  return {
    value: {
      region, regionName, age, services, rateMin, rateMax,
      lang: LANGS.includes(b.lang) ? b.lang : "en",
      kind: KINDS.includes(b.kind) ? b.kind : "both",
      moods: (Array.isArray(b.moods) ? b.moods : []).filter((m) => MOODS.includes(m)).slice(0, 13),
      wish: str(b.wish, 500),
      exclude: (Array.isArray(b.exclude) ? b.exclude : []).map((t) => str(t, 120)).filter(Boolean).slice(0, 60)
    }
  };
}

/* ---------- käyttörajat ---------- */
const hits = new Map();
let day = new Date().toDateString(), dayCount = 0;
function limited(ip) {
  const now = Date.now();
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); dayCount = 0; }
  if (dayCount >= DAILY_LIMIT) return true;
  const arr = (hits.get(ip) || []).filter((t) => now - t < 600e3);
  if (arr.length >= RATE_PER_10MIN) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  dayCount++;
  if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 4000) break; }
  return false;
}
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

/* ---------- apufunktiot ---------- */
function sendJson(res, status, obj) {
  res.writeHead(status, { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleSuggest(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return sendJson(res, 400, { t: "error", code: "bad_request" }); }
  const parsed = parseInput(body);
  if (parsed.error) return sendJson(res, 400, { t: "error", code: "bad_request", field: parsed.error });
  if (limited(clientIp(req))) return sendJson(res, 429, { t: "error", code: "limit" });

  res.writeHead(200, { ...SECURITY, "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  const send = (ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + "\n"); };
  try {
    const out = await suggest(parsed.value, { onStatus: (k) => send({ t: "status", k }), signal: ac.signal });
    send({ t: "result", items: out.items, unmatched: out.unmatched });
  } catch (e) {
    if (!(e instanceof AgentError) || ["agent", "tmdb", "upstream"].includes(e.code)) console.error("suggest failed:", e && (e.detail || e.message || e));
    if (e instanceof AgentError && e.code === "aborted") { /* selain sulki yhteyden */ }
    else if (e instanceof AgentError) send({ t: "error", code: e.code, unmatched: e.unmatched });
    else send({ t: "error", code: "agent" });
  } finally {
    res.end();
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400, SECURITY); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403, SECURITY); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...SECURITY, "content-type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...SECURITY,
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/suggest") return void handleSuggest(req, res);
  if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, url.pathname);
  res.writeHead(405, SECURITY);
  res.end();
});
server.requestTimeout = 0;      // haku voi kestää puoli minuuttia
server.headersTimeout = 20000;

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

server.listen(PORT, () => {
  console.log(`What to Watch käynnissä: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("Ei ANTHROPIC_API_KEY:tä: haku toimii ilman tekoälyä.");
  if (!process.env.TMDB_API_KEY) console.warn("Varoitus: TMDB_API_KEY puuttuu.");
});
