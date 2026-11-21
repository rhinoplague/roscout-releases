// RoScout shared data collector.
// GitHub Actions runs this every 30 minutes (see .github/workflows/collect.yml). It reads Roblox's
// public discovery lists (the same ones the Charts page shows), records how many people are playing
// every game on them, and keeps following each game for 30 days after it was last on a list.
// Every RoScout install reads the result from the "data" branch, so everyone sees the same history,
// even for games they never tracked themselves.
//
// usage: node collect.mjs <dataDir> <watch.json>
//
// <dataDir>/
//   meta.json          { v, updated, recentStart, months, games: { id: [name, placeId, genre, creator, firstSeen, lastSeen, lastInList] } }
//   recent/<b>.json    { s: recentStart, g: { id: [players per 30-minute slot] } }      last ~4 days   (b = id % 64)
//   hist/<YYYY-MM>/<b>.json  { s: first hour of the month, g: { id: [average players per hour] } }   ~90 days
//   top.json           the 100 most-played games right now, with their last 24h
//   rise.json          every game's players now, 1h, 6h and 24h ago (for the Rising feed)

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'data';
const WATCH = process.argv[3] || 'watch.json';
const SLOT = 30 * 60e3;
const HOUR = 36e5;
const RECENT_MAX = 96 * HOUR;     // compact once recent/ holds more than 4 days…
const RECENT_KEEP = 72 * HOUR;    // …down to the last 3 days
const HIST_DAYS = 92;
const BUCKETS = 64;
const MAX_GAMES = 2500;
const FOLLOW_MS = 30 * 864e5;
const UA = 'RoScout-collector/1 (+https://github.com/rhinoplague/roscout-releases)';
const SKIP_SORTS = /music|sponsored|filters/i;

const sleep = (ms) => (process.env.COLLECT_FAST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const monthOf = (hour) => new Date(hour * HOUR).toISOString().slice(0, 7);
const monthStart = (m) => Date.parse(`${m}-01T00:00:00Z`) / HOUR;
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${url}`), { fatal: true });
      return await r.json();
    } catch (e) {
      if (e.fatal || i >= tries) throw e;
      await sleep(1500 * i);
    }
  }
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJSON(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj));
}

// ---- 1. what's on Roblox's lists right now ------------------------------------------
async function discover() {
  const sid = crypto.randomUUID();
  const seen = new Map(); // id -> { n, p, g, c, v }
  const take = (x, listed) => {
    if (!x.universeId || x.isSponsored) return;
    const prev = seen.get(x.universeId);
    seen.set(x.universeId, {
      n: x.name ?? prev?.n, p: x.rootPlaceId ?? prev?.p, g: x.genreL1 || prev?.g || '',
      c: x.creatorName || prev?.c || '', v: x.playerCount ?? prev?.v ?? null, listed: listed || prev?.listed,
    });
  };
  let token = '';
  let lists = 0;
  for (let page = 0; page < 6; page++) {
    const r = await getJSON(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sid}&device=computer&country=all${token ? `&sortsPageToken=${encodeURIComponent(token)}` : ''}`);
    for (const s of r.sorts || []) {
      if (!(s.games || []).length || SKIP_SORTS.test(s.sortId)) continue;
      lists++;
      for (const g of s.games) take(g, true);
    }
    token = r.nextSortsPageToken || '';
    if (!token) break;
    await sleep(300);
  }
  const watch = await readJSON(WATCH, {});
  for (const kw of (watch.keywords || []).slice(0, 12)) {
    try {
      const r = await getJSON(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(kw)}&sessionId=${sid}&pageType=all`);
      for (const grp of r.searchResults || []) if (grp.contentGroupType === 'Game') for (const g of (grp.contents || []).slice(0, 40)) take(g, true);
    } catch (e) { console.warn(`search "${kw}": ${e.message}`); }
    await sleep(300);
  }
  console.log(`lists: ${lists}, games on them: ${seen.size}`);
  return { seen, watchIds: (watch.universeIds || []).map(Number).filter(Boolean) };
}

// ---- 2. player counts for games we follow that aren't on a list right now --------------
async function counts(ids) {
  const out = new Map();
  for (const c of chunk(ids, 50)) {
    try {
      const r = await getJSON(`https://games.roblox.com/v1/games?universeIds=${c.join(',')}`);
      for (const g of r.data || []) out.set(g.id, { n: g.name, p: g.rootPlaceId, c: g.creator?.name || '', v: g.playing ?? null });
    } catch (e) { console.warn(`games batch: ${e.message}`); }
    await sleep(250);
  }
  return out;
}

async function main() {
  const now = Date.now();
  const slot = Math.floor(now / SLOT);
  const meta = await readJSON(path.join(OUT, 'meta.json'), { v: 1, games: {} });
  meta.recentStart ??= slot;
  delete meta.histStart;

  const { seen, watchIds } = await discover();
  // follow: on a list now, on a list in the last 30 days, or in watch.json
  for (const [id, x] of seen) {
    const m = meta.games[id] || [x.n, x.p, x.g, x.c, now, now, now];
    meta.games[id] = [x.n || m[0], x.p || m[1], x.g || m[2], x.c || m[3], m[4], now, x.listed ? now : m[6]];
  }
  const watched = new Set(watchIds.map(String));
  let follow = Object.keys(meta.games).filter((id) => watched.has(id) || now - (meta.games[id][6] || 0) < FOLLOW_MS);
  const missing = [...new Set([...follow.filter((id) => !seen.has(Number(id))), ...[...watched].filter((id) => !meta.games[id])])];
  const extra = await counts(missing.map(Number));
  for (const [id, x] of extra) {
    const m = meta.games[id] || [x.n, x.p, '', x.c, now, now, watched.has(String(id)) ? now : 0];
    meta.games[id] = [x.n || m[0], x.p || m[1], m[2], x.c || m[3], m[4], now, m[6]];
    if (!follow.includes(String(id))) follow.push(String(id));
  }
  const value = (id) => seen.get(Number(id))?.v ?? extra.get(Number(id))?.v ?? null;
  // keep the busiest games if there are too many
  if (follow.length > MAX_GAMES) {
    follow.sort((a, b) => (watched.has(b) - watched.has(a)) || ((value(b) ?? -1) - (value(a) ?? -1)));
    follow = follow.slice(0, MAX_GAMES);
  }
  const followSet = new Set(follow);
  for (const id of Object.keys(meta.games)) if (!followSet.has(id) && now - meta.games[id][5] > FOLLOW_MS) delete meta.games[id];

  // ---- 3. write this slot into recent/ ---------------------------------------------------
  const idx = slot - meta.recentStart;
  const recent = {};
  for (let b = 0; b < BUCKETS; b++) recent[b] = await readJSON(path.join(OUT, `recent/${b}.json`), { s: meta.recentStart, g: {} });
  let recorded = 0;
  for (const id of follow) {
    const v = value(id);
    if (v == null) continue;
    const arr = recent[id % BUCKETS].g[id] || (recent[id % BUCKETS].g[id] = []);
    while (arr.length < idx) arr.push(null);
    arr[idx] = v;
    recorded++;
  }
  console.log(`recorded ${recorded} games at slot ${slot}`);

  // ---- 4. daily compaction: recent/ (30 min) older than 3 days -> hist/<month>/ (hourly) ----
  if ((slot - meta.recentStart) * SLOT > RECENT_MAX) {
    const cut = Math.floor((now - RECENT_KEEP) / SLOT);
    const drop = cut - meta.recentStart;
    const files = new Map();
    const histFile = async (month, b) => {
      const key = `${month}/${b}`;
      if (!files.has(key)) files.set(key, await readJSON(path.join(OUT, `hist/${key}.json`), { s: monthStart(month), g: {} }));
      return files.get(key);
    };
    for (let b = 0; b < BUCKETS; b++) {
      for (const [id, arr] of Object.entries(recent[b].g)) {
        const sums = new Map();
        for (let i = 0; i < Math.min(drop, arr.length); i++) {
          if (arr[i] == null) continue;
          const hour = Math.floor(((meta.recentStart + i) * SLOT) / HOUR);
          const e = sums.get(hour) || [0, 0]; e[0] += arr[i]; e[1]++; sums.set(hour, e);
        }
        for (const [hour, [sum, n]] of sums) {
          const h = await histFile(monthOf(hour), b);
          const list = h.g[id] || (h.g[id] = []);
          const j = hour - h.s;
          while (list.length <= j) list.push(null);
          list[j] = Math.round(sum / n);
        }
        recent[b].g[id] = arr.slice(drop);
        if (!recent[b].g[id].some((x) => x != null)) delete recent[b].g[id];
      }
    }
    for (const [key, h] of files) await writeJSON(path.join(OUT, `hist/${key}.json`), h);
    // forget months older than ~3 months
    const oldest = monthOf(Math.floor((now - HIST_DAYS * 864e5) / HOUR));
    let months = [];
    try { months = (await fs.readdir(path.join(OUT, 'hist'))).filter((m) => /^\d{4}-\d{2}$/.test(m)); } catch {}
    for (const m of months) if (m < oldest) await fs.rm(path.join(OUT, 'hist', m), { recursive: true, force: true });
    meta.months = months.filter((m) => m >= oldest).sort();
    meta.recentStart = cut;
    console.log(`compacted recent -> hist (${files.size} files)`);
  }
  for (let b = 0; b < BUCKETS; b++) {
    for (const id of Object.keys(recent[b].g)) if (!meta.games[id]) delete recent[b].g[id];
    recent[b].s = meta.recentStart;
    await writeJSON(path.join(OUT, `recent/${b}.json`), recent[b]);
  }

  // ---- 5. top.json and rise.json --------------------------------------------------------
  const at = (id, back) => {
    const arr = recent[id % BUCKETS].g[id];
    if (!arr) return null;
    const i = slot - back - meta.recentStart;
    for (const k of [i, i - 1, i + 1]) if (k >= 0 && arr[k] != null) return arr[k];
    return null;
  };
  const rows = follow.map((id) => ({ id: Number(id), v: value(id) })).filter((r) => r.v != null);
  rows.sort((a, b) => b.v - a.v);
  const info = (id) => { const m = meta.games[id]; return { n: m[0], p: m[1], g: m[2], c: m[3] }; };
  const start24 = slot - 47;
  await writeJSON(path.join(OUT, 'top.json'), {
    updated: now, slot, s: start24, slotMs: SLOT,
    list: rows.slice(0, 100).map((r, i) => {
      const arr = recent[r.id % BUCKETS].g[r.id] || [];
      const d = [];
      for (let k = start24; k <= slot; k++) d.push(arr[k - meta.recentStart] ?? null);
      return { id: r.id, rank: i + 1, ...info(r.id), v: r.v, d };
    }),
  });
  const rise = {};
  for (const r of rows) if (r.v >= 20) rise[r.id] = [r.v, at(r.id, 2), at(r.id, 12), at(r.id, 48), ...Object.values(info(r.id))];
  await writeJSON(path.join(OUT, 'rise.json'), { updated: now, slot, g: rise });

  meta.updated = now;
  meta.buckets = BUCKETS; meta.slotMs = SLOT;
  await writeJSON(path.join(OUT, 'meta.json'), meta);
  console.log(`following ${follow.length} games; top: ${rows.slice(0, 3).map((r) => `${meta.games[r.id][0]} (${r.v})`).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
