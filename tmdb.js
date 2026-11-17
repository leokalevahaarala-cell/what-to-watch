// TMDB-rajapinnan käyttö: palvelujen tarjonta, nimikkeiden haku ja tiedot.
// Saatavuustiedot ovat JustWatchin, ja TMDB välittää ne (watch/providers).

const BASE = () => (process.env.TMDB_BASE || "https://api.themoviedb.org/3").replace(/\/$/, "");
const HOUR = 3600e3;

export class TmdbError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---------- pieni muistivälimuisti, jotta rajapintaa ei kuormiteta turhaan ---------- */
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { exp: Date.now() + ttlMs, p });
  if (cache.size > 6000) {
    let n = 0;
    for (const k of cache.keys()) { cache.delete(k); if (++n > 1500) break; }
  }
  return p;
}

export async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new TmdbError("config", "TMDB_API_KEY puuttuu");
  const url = new URL(BASE() + path);
  const headers = { accept: "application/json" };
  // v4-lukuavain on JWT ("eyJ..."), v3-avain on lyhyt merkkijono.
  if (key.startsWith("eyJ")) headers.authorization = "Bearer " + key;
  else url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new TmdbError("tmdb_down", "TMDB ei vastaa: " + e.message);
  }
  if (res.status === 401) throw new TmdbError("config", "TMDB hylkäsi avaimen");
  if (res.status === 404) throw new TmdbError("not_found", "Nimikettä ei löytynyt");
  if (res.status === 429) throw new TmdbError("busy", "TMDB:n pyyntöraja täynnä");
  if (!res.ok) throw new TmdbError("tmdb_down", "TMDB vastasi " + res.status);
  return res.json();
}

/* ---------- palvelujen tunnistus ---------- */
const norm = (s) => String(s || "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9äöå]/g, "");
const ALIASES = {
  hbomax: ["hbomax", "max"],
  primevideo: ["primevideo", "amazonprimevideo", "amazonvideo"],
  appletv: ["appletv", "appletvplus"],
  mtvkatsomo: ["mtvkatsomo", "katsomo"],
  disneyplus: ["disneyplus"],
  paramountplus: ["paramountplus"]
};

export const getProviders = (region) => cached("prov:" + region, 12 * HOUR, async () => {
  const [m, t] = await Promise.all([
    tmdb("/watch/providers/movie", { watch_region: region }),
    tmdb("/watch/providers/tv", { watch_region: region })
  ]);
  const map = new Map();
  for (const p of [...(m.results || []), ...(t.results || [])]) map.set(p.provider_id, { id: p.provider_id, name: p.provider_name });
  return [...map.values()];
});

/** Yhdistää käyttäjän valitsemat palvelunimet TMDB:n palveluihin kyseisessä maassa. */
export function matchServices(names, providers) {
  const matched = [], unmatched = [];
  for (const name of names) {
    const n = norm(name);
    if (!n) continue;
    const keys = ALIASES[n] || [n];
    const ids = providers
      .filter((p) => { const pn = norm(p.name); return keys.some((k) => pn === k || (k.length >= 4 && pn.startsWith(k))); })
      .map((p) => p.id);
    if (ids.length) matched.push({ name, ids });
    else unmatched.push(name);
  }
  return { matched, unmatched };
}

/* ---------- lajit ---------- */
export const getGenres = (kind, lang) => cached(`gen:${kind}:${lang}`, 24 * HOUR, async () => {
  const r = await tmdb(`/genre/${kind}/list`, { language: lang });
  return r.genres || [];
});

export async function genreIdsByName(kind, names) {
  if (!names || !names.length) return [];
  const all = await getGenres(kind, "en-US");
  const out = [];
  for (const n of names) {
    const q = String(n).toLowerCase();
    const g = all.find((x) => x.name.toLowerCase() === q) || all.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()));
    if (g && !out.includes(g.id)) out.push(g.id);
  }
  return out;
}

/* ---------- haku ja selaus ---------- */
const year = (d) => (d || "").slice(0, 4);
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function lite(kind, x) {
  return {
    id: x.id,
    kind,
    title: x.original_title || x.original_name || x.title || x.name || "",
    year: year(x.release_date || x.first_air_date),
    genreIds: x.genre_ids || [],
    vote: round1(x.vote_average),
    votes: x.vote_count || 0,
    language: x.original_language || "",
    overview: clip(x.overview, 140)
  };
}

/** Selaa palvelun oikeaa tarjontaa (flatrate = kuuluu tilaukseen) tietyssä maassa. */
export async function discover({ kind, region, providerIds, genreIds = [], minYear, maxYear, sort, page = 1 }) {
  const movie = kind === "movie";
  const params = {
    watch_region: region,
    with_watch_providers: providerIds.join("|"),
    with_watch_monetization_types: "flatrate",
    sort_by: sort === "top_rated" ? "vote_average.desc" : "popularity.desc",
    "vote_count.gte": sort === "top_rated" ? 300 : 40,
    include_adult: "false",
    language: "en-US",
    page,
    with_genres: genreIds.length ? genreIds.join("|") : undefined
  };
  if (minYear) params[movie ? "primary_release_date.gte" : "first_air_date.gte"] = `${minYear}-01-01`;
  if (maxYear) params[movie ? "primary_release_date.lte" : "first_air_date.lte"] = `${maxYear}-12-31`;
  const r = await cached("disc:" + kind + JSON.stringify(params), 30 * 60e3, () => tmdb(`/discover/${kind}`, params));
  return { page: r.page || page, totalPages: r.total_pages || 0, results: (r.results || []).map((x) => lite(kind, x)) };
}

export async function searchTitle(kind, query, y) {
  const kinds = kind === "movie" || kind === "tv" ? [kind] : ["movie", "tv"];
  const rs = await Promise.all(kinds.map((k) => tmdb(`/search/${k}`, {
    query, include_adult: "false", language: "en-US",
    ...(y ? (k === "movie" ? { primary_release_year: y } : { first_air_date_year: y }) : {})
  })));
  return rs.flatMap((r, i) => (r.results || []).slice(0, 3).map((x) => lite(kinds[i], x)));
}

/* ---------- saatavuus ---------- */
export const getAvailability = (kind, id, region) => cached(`av:${kind}:${id}:${region}`, 3 * HOUR, async () => {
  const r = await tmdb(`/${kind}/${id}/watch/providers`);
  const x = (r.results || {})[region] || {};
  return { link: x.link || null, flatrate: (x.flatrate || []).map((p) => ({ id: p.provider_id, name: p.provider_name })) };
});

/** Kertoo, mitkä käyttäjän valitsemista palveluista sisältävät nimikkeen tilaukseen kuuluvana. */
export function servicesOffering(matched, availability) {
  const have = new Set(availability.flatrate.map((p) => p.id));
  return matched.filter((m) => m.ids.some((id) => have.has(id))).map((m) => m.name);
}

/* ---------- ikärajat ---------- */
export function certToAge(raw) {
  const c = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  if (/^(S|ALL|ALLA|BTL|TP|U|G|AL|A|L|TV-Y|TV-G|0|APTA|ATP)$/.test(c)) return 0;
  if (/^(TV-Y7|PG|TV-PG)$/.test(c)) return 7;
  if (c === "PG-13") return 12;
  if (c === "TV-14" || c === "R") return 16;
  if (/^(TV-MA|NC-17|X|XXX)$/.test(c)) return 18;
  const m = c.match(/(\d{1,2})/);
  if (!m) return null;
  const n = +m[1];
  if (n <= 0) return 0;
  if (n <= 7) return 7;
  if (n <= 12) return 12;
  if (n <= 16) return 16;
  return 18;
}

/** Palauttaa pienimmän ikärajan lukuna (0, 7, 12, 16, 18). approx = arvio Yhdysvaltain luokituksesta. */
export function ageFor(details, region) {
  const own = details.certs.find((c) => c.region === region && c.cert);
  if (own) { const a = certToAge(own.cert); if (a !== null) return { age: a, approx: false }; }
  const us = details.certs.find((c) => c.region === "US" && c.cert);
  if (us) { const a = certToAge(us.cert); if (a !== null) return { age: a, approx: true }; }
  return { age: null, approx: false };
}

/* ---------- tiedot ---------- */
const NON_LATIN = /[^\u0000-ɏḀ-ỿ -⁯\s]/;

export const getDetails = (kind, id) => cached(`det:${kind}:${id}`, 24 * HOUR, async () => {
  const r = await tmdb(`/${kind}/${id}`, {
    language: "en-US",
    append_to_response: kind === "movie" ? "external_ids,release_dates" : "external_ids,content_ratings"
  });
  const certs = [];
  if (kind === "movie") {
    for (const e of (r.release_dates && r.release_dates.results) || []) {
      const c = (e.release_dates || []).map((x) => x.certification).find(Boolean);
      if (c) certs.push({ region: e.iso_3166_1, cert: c });
    }
  } else {
    for (const e of (r.content_ratings && r.content_ratings.results) || []) {
      if (e.rating) certs.push({ region: e.iso_3166_1, cert: e.rating });
    }
  }
  const original = r.original_title || r.original_name || "";
  // Alkuperäinen nimi. Jos se on muulla kuin latinalaisella kirjoituksella, käytetään kansainvälistä nimeä.
  const title = original && !NON_LATIN.test(original) ? original : (r.title || r.name || original);
  return {
    id,
    kind,
    title,
    year: year(r.release_date || r.first_air_date),
    genreIds: (r.genres || []).map((g) => g.id),
    runtimeMin: r.runtime || null,
    seasons: r.number_of_seasons || null,
    vote: round1(r.vote_average),
    votes: r.vote_count || 0,
    poster: r.poster_path || null,
    imdbId: r.imdb_id || (r.external_ids && r.external_ids.imdb_id) || null,
    certs
  };
});

export const TMDB_LANG = { fi: "fi-FI", en: "en-US", sv: "sv-SE", de: "de-DE", es: "es-ES", fr: "fr-FR" };

export async function genreNames(kind, ids, uiLang) {
  const all = await getGenres(kind, TMDB_LANG[uiLang] || "en-US");
  return ids.map((id) => (all.find((g) => g.id === id) || {}).name).filter(Boolean);
}
