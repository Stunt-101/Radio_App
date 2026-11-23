// Station directory: the genre map, the snapshot shipped with the site (stations.json,
// every stream tested by tools/audit.mjs), and live Radio Browser lookups that refresh
// each sub-genre at most once a day.

import { cache, hidden, failures } from './store.js';

const DAY = 24 * 3600e3;
const FALLBACK_SERVERS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const OK_CODECS = new Set(['MP3', 'AAC', 'AAC+']);

let genres = null;
let snapshot = { subgenres: {}, stations: {} };
const live = {}; // sgId -> stations from the live directory

export const norm = s => String(s).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}&]+/gu, '');
const isIp = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':');

export async function load() {
  const [g, s] = await Promise.all([
    fetch('genres.json').then(r => r.json()),
    fetch('stations.json').then(r => r.json()).catch(() => null),
  ]);
  genres = g;
  if (s) snapshot = s;
  for (const cat of genres.categories) for (const sg of cat.subgenres) {
    sg.category = cat;
    const c = cache.get('sg.' + sg.id, DAY);
    if (c) live[sg.id] = c;
  }
  return genres;
}

export const categories = () => genres.categories;
export const category = id => genres.categories.find(c => c.id === id);
export function subgenre(id) {
  for (const c of genres.categories) { const s = c.subgenres.find(x => x.id === id); if (s) return s; }
  return null;
}

// ---------- Station objects ----------
function fromSnapshot(id, sgId) {
  const s = snapshot.stations[id]; if (!s) return null;
  return { id, name: s.n, url: s.u, favicon: s.f, country: s.c, language: s.l, tags: s.t || [], codec: s.k, bitrate: s.b,
    score: s.s || 0, verified: true, pinned: !!s.p, sg: sgId };
}

// Turn a raw Radio Browser record into a station we can play in Safari, or null.
export function fromDirectory(r, sgId = '') {
  if (!r || r.lastcheckok !== 1) return null;
  let u; try { u = new URL(r.url_resolved || r.url); } catch { return null; }
  if (isIp(u.hostname)) return null;
  const hls = r.hls === 1 || /\.m3u8(\?|$)/i.test(u.pathname);
  const codec = (r.codec || '').toUpperCase();
  if (!hls && !OK_CODECS.has(codec)) return null;
  const upgraded = u.protocol === 'http:';
  if (upgraded) u.protocol = 'https:';   // about half of http-only stations also answer on https
  if (u.protocol !== 'https:') return null;
  return {
    id: r.stationuuid, name: (r.name || '').trim() || 'Unnamed station', url: u.href,
    favicon: /^https:\/\//i.test(r.favicon || '') ? r.favicon : '', country: r.countrycode || '',
    language: (r.language || '').split(',')[0].trim(), tags: (r.tags || '').split(',').map(norm).filter(Boolean).slice(0, 6),
    codec: hls ? 'HLS' : codec, bitrate: r.bitrate || 0,
    score: (r.votes || 0) + 3 * (r.clickcount || 0) + 2 * Math.max(0, r.clicktrend || 0),
    verified: false, upgraded, sg: sgId,
  };
}

// ---------- Ranking ----------
function matcher(sg) {
  const rule = r => ({ tags: new Set((r.tags || []).map(norm)), names: (r.names || []).map(x => x.toLowerCase()),
    countries: r.countries && new Set(r.countries), excl: r.excludeCountries && new Set(r.excludeCountries) });
  const rules = [rule(sg), ...(sg.extra || []).map(rule)];
  const exT = new Set((sg.excludeTags || []).map(norm)), exN = (sg.excludeNames || []).map(x => x.toLowerCase());
  return (st, rawTags) => {
    const tags = rawTags || st.tags, name = st.name.toLowerCase(), cc = (st.country || '').toUpperCase();
    if (tags.some(t => exT.has(t)) || exN.some(x => name.includes(x))) return false;
    return rules.some(r => (!r.countries || r.countries.has(cc)) && (!r.excl || !r.excl.has(cc)) &&
      (tags.some(t => r.tags.has(t)) || r.names.some(x => name.includes(x))));
  };
}

// The ordered list of stations for a sub-genre: pinned, then stations that work,
// preferred language, tested by the audit, then popularity. Hidden stations never appear.
export function stationsFor(sgId) {
  const sg = subgenre(sgId); if (!sg) return [];
  const seen = new Set(), seenUrl = new Set(), out = [];
  const add = st => { if (st && !seen.has(st.id) && !seenUrl.has(st.url) && !hidden.has(st.id)) { seen.add(st.id); seenUrl.add(st.url); out.push(st); } };
  (snapshot.subgenres[sgId] || []).forEach(id => add(fromSnapshot(id, sgId)));
  (live[sgId] || []).forEach(add);
  const pins = sg.pin || [];
  const langs = (sg.prefer || sg.category.prefer || []).map(x => x.toLowerCase());
  const key = st => [
    pins.includes(st.id) ? pins.indexOf(st.id) : 999,
    failures.recent(st.id) ? 1 : 0,
    langs.length && !langs.some(l => (st.language || '').toLowerCase().includes(l)) ? 1 : 0,
    st.verified ? 0 : st.upgraded ? 2 : 1,
    -st.score,
  ];
  return out.map(st => [key(st), st]).sort((a, b) => {
    for (let i = 0; i < a[0].length; i++) if (a[0][i] !== b[0][i]) return a[0][i] - b[0][i];
    return 0;
  }).map(x => x[1]);
}

// ---------- Live Radio Browser API ----------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

let serverPromise = null;
function servers() {
  return serverPromise ||= (async () => {
    let list = cache.get('servers', DAY);
    if (!list) {
      try {
        const r = await fetch('https://all.api.radio-browser.info/json/servers', { signal: AbortSignal.timeout(8000) });
        list = [...new Set((await r.json()).map(s => s.name).filter(Boolean))];
        if (list.length) cache.set('servers', list);
      } catch { list = null; }
    }
    return shuffle([...(list && list.length ? list : FALLBACK_SERVERS)]);
  })();
}

// Calls the API, trying the next server if one fails.
export async function api(pathAndQuery, timeoutMs = 10000) {
  const hosts = await servers();
  let lastErr;
  for (let i = 0; i < hosts.length; i++) {
    try {
      const r = await fetch(`https://${hosts[i]}${pathAndQuery}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (i) hosts.push(...hosts.splice(0, i)); // remember the one that worked
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No directory server answered');
}

// Run fn over items, at most n at a time (the directory rate-limits bursts). Like Promise.allSettled.
async function limited(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { status: 'fulfilled', value: await fn(items[k]) }; } catch (e) { out[k] = { status: 'rejected', reason: e }; } }
  }));
  return out;
}

const refreshing = {};
// Refresh a sub-genre from the live directory if its cached copy is older than a day.
export function refresh(sgId) {
  if (live[sgId] || refreshing[sgId]) return refreshing[sgId] || Promise.resolve();
  const sg = subgenre(sgId); if (!sg) return Promise.resolve();
  const match = matcher(sg);
  const countries = sg.countries && sg.countries.length === 1 ? `&countrycode=${sg.countries[0]}` : '';
  const queries = [
    ...(sg.tags || []).slice(0, 8).map(t => `/json/stations/search?tag=${encodeURIComponent(t)}&tagExact=true${countries}`),
    ...(sg.extra || []).flatMap(e => e.tags.map(t => `/json/stations/search?tag=${encodeURIComponent(t)}&tagExact=true${e.countries?.length === 1 ? '&countrycode=' + e.countries[0] : ''}`)),
    ...(sg.names || []).slice(0, 4).map(n => `/json/stations/search?name=${encodeURIComponent(n)}${countries}`),
  ].map(q => q + '&hidebroken=true&order=clickcount&reverse=true&limit=40');
  return refreshing[sgId] = limited(queries, 3, q => api(q)).then(results => {
    const found = [];
    for (const r of results) if (r.status === 'fulfilled') for (const raw of r.value) {
      const st = fromDirectory(raw, sgId);
      if (st && match(st, (raw.tags || '').split(',').map(norm))) found.push(st);
    }
    if (results.some(r => r.status === 'fulfilled')) { live[sgId] = found; cache.set('sg.' + sgId, found); }
  }).finally(() => { delete refreshing[sgId]; });
}

// Tell the directory a station was played (it uses this for popularity). Fire and forget.
export function reportClick(id) {
  if (id) api(`/json/url/${encodeURIComponent(id)}`, 5000).catch(() => {});
}

export async function search(text) {
  const q = encodeURIComponent(text.trim());
  const raw = await api(`/json/stations/search?name=${q}&hidebroken=true&order=clickcount&reverse=true&limit=60`);
  const seen = new Set();
  return raw.map(r => fromDirectory(r)).filter(st => st && !hidden.has(st.id) && !seen.has(st.url) && seen.add(st.url));
}

// A replacement for a favorite that stopped working: same sub-genre, else shared tags.
export function similarTo(st) {
  if (st.sg) { const list = stationsFor(st.sg).filter(x => x.id !== st.id && !failures.recent(x.id)); if (list.length) return list; }
  const tags = new Set(st.tags || []);
  for (const cat of genres.categories) for (const sg of cat.subgenres) {
    if ((sg.tags || []).some(t => tags.has(norm(t)))) { const list = stationsFor(sg.id).filter(x => x.id !== st.id); if (list.length) return list; }
  }
  return [];
}
