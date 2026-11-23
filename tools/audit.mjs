#!/usr/bin/env node
// Station audit for the Car Radio site.
// Usage: node tools/audit.mjs [--probe N] [--refresh]
// Reads genres.json, pulls every station from Radio Browser once (cached for 24h),
// counts raw vs playable stations per sub-genre, then probes the top N playable
// stream URLs per sub-genre to see whether they really return audio.
// Writes audit/report.md and audit/results.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'audit', '.cache', 'stations.json');
const UA = 'CarRadioAudit/0.1';
const args = process.argv.slice(2);
const PROBE_N = Number(args[args.indexOf('--probe') + 1]) || 30;
const REFRESH = args.includes('--refresh');
const PROBE_TIMEOUT_MS = 10000;
const PROBE_BYTES = 24 * 1024;
const CONCURRENCY = 24;

// ---------- Radio Browser client: server list, shuffle, retry next on failure ----------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function getServers() {
  const fallback = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info', 'nl1.api.radio-browser.info'];
  try {
    const r = await fetch('https://all.api.radio-browser.info/json/servers', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const list = [...new Set((await r.json()).map(s => s.name))];
    if (list.length) return shuffle(list);
  } catch (e) { console.warn('server list failed, using fallback:', e.message); }
  return shuffle(fallback);
}

async function rb(pathAndQuery, servers) {
  let lastErr;
  for (const host of servers) {
    try {
      const r = await fetch(`https://${host}${pathAndQuery}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { host, data: await r.json() };
    } catch (e) { lastErr = e; console.warn(`  ${host} failed (${e.message}), trying next`); }
  }
  throw lastErr;
}

// ---------- Matching ----------
const norm = s => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}&]+/gu, '');
const isIp = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':');
const OK_CODECS = new Set(['MP3', 'AAC', 'AAC+']);

function compileRule(r) {
  return {
    tags: new Set((r.tags || []).map(norm)),
    names: (r.names || []).map(s => s.toLowerCase()),
    countries: r.countries && new Set(r.countries),
    excludeCountries: r.excludeCountries && new Set(r.excludeCountries),
  };
}
function ruleMatches(rule, st) {
  const cc = (st.countrycode || '').toUpperCase();
  if (rule.countries && !rule.countries.has(cc)) return false;
  if (rule.excludeCountries && rule.excludeCountries.has(cc)) return false;
  if (st._tags.some(t => rule.tags.has(t))) return true;
  const n = (st.name || '').toLowerCase();
  return rule.names.some(x => n.includes(x));
}

function playableReason(st) {
  if (st.lastcheckok !== 1) return 'not-working';
  let u;
  try { u = new URL(st.url_resolved || st.url); } catch { return 'bad-url'; }
  if (u.protocol !== 'https:') return 'http-only';
  if (isIp(u.hostname)) return 'bare-ip';
  const codec = (st.codec || '').toUpperCase();
  if (!(st.hls === 1 || OK_CODECS.has(codec) || /\.m3u8(\?|$)/i.test(u.pathname))) return `codec-${codec || 'none'}`;
  return 'ok';
}
const score = st => (st.votes || 0) + 3 * (st.clickcount || 0) + 2 * Math.max(0, st.clicktrend || 0);

// ---------- Stream probe ----------
const MP3_BR = { // [versionKey][layer3] kbps by index
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const ADTS_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function mp3FrameAt(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null; // layer III only
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (bri === 0 || bri === 15 || sri === 3) return null;
  const kbps = MP3_BR[ver === 3 ? 1 : 2][bri], sr = MP3_SR[ver][sri];
  const len = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / sr) + pad;
  return { kbps, sr, len };
}
function adtsFrameAt(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xF6) !== 0xF0) return null;
  const sri = (b[i + 2] >> 2) & 0xF; if (sri >= ADTS_SR.length) return null;
  const len = ((b[i + 3] & 3) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
  if (len < 7) return null;
  return { sr: ADTS_SR[sri], len, profile: (b[i + 2] >> 6) + 1 };
}
function sniff(buf) {
  const b = buf;
  let start = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) start = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  const txt = Buffer.from(b.subarray(0, 200)).toString('latin1');
  if (txt.startsWith('#EXTM3U')) return { kind: 'hls-playlist' };
  if (/^\s*\[playlist\]/i.test(txt) || /^\s*(#EXTINF|https?:\/\/)/i.test(txt)) return { kind: 'playlist-file' };
  if (/^\s*<(!doctype|html|\?xml)/i.test(txt)) return { kind: 'html' };
  if (txt.startsWith('OggS')) return { kind: 'audio', codec: 'OGG' };
  if (txt.startsWith('fLaC')) return { kind: 'audio', codec: 'FLAC' };
  if (txt.slice(4, 8) === 'ftyp') return { kind: 'audio', codec: 'MP4/AAC' };
  if (b[0] === 0x47 && b[188] === 0x47) return { kind: 'audio', codec: 'MPEG-TS' };
  for (let i = start; i < b.length - 8; i++) {
    const a = adtsFrameAt(b, i);
    if (a) { // confirm with following frames, average length -> bitrate
      let j = i, n = 0, total = 0;
      while (j < b.length - 8 && n < 40) { const f = adtsFrameAt(b, j); if (!f) break; total += f.len; j += f.len; n++; }
      if (n >= 3) return { kind: 'audio', codec: a.profile === 2 ? 'AAC-LC/HE' : 'AAC', sampleRate: a.sr, kbps: Math.round((total / n) * 8 * a.sr / 1024 / 1000) };
    }
    const m = mp3FrameAt(b, i);
    if (m) {
      let j = i, n = 0; const rates = [];
      while (j < b.length - 4 && n < 40) { const f = mp3FrameAt(b, j); if (!f) break; rates.push(f.kbps); j += f.len; n++; }
      if (n >= 3) return { kind: 'audio', codec: 'MP3', sampleRate: m.sr, kbps: Math.round(rates.reduce((x, y) => x + y, 0) / n) };
    }
  }
  return { kind: 'unknown' };
}

async function readSome(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Origin': 'https://example.github.io', ...extraHeaders }, signal: ctrl.signal, redirect: 'follow' });
    const headers = Object.fromEntries(r.headers);
    const chunks = []; let got = 0;
    if (r.body) {
      const reader = r.body.getReader();
      while (got < PROBE_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
      try { await reader.cancel(); } catch {}
    }
    return { status: r.status, finalUrl: r.url, headers, bytes: Buffer.concat(chunks) };
  } finally { clearTimeout(timer); ctrl.abort(); }
}

function parseM3u8(text, base) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const variants = [], segs = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const attrs = lines[i];
      variants.push({ bw: Number((attrs.match(/BANDWIDTH=(\d+)/) || [])[1]) || 0, codecs: (attrs.match(/CODECS="([^"]+)"/) || [])[1] || '', url: new URL(lines[i + 1], base).href });
    } else if (!lines[i].startsWith('#')) segs.push(new URL(lines[i], base).href);
  }
  return { variants, segs };
}

async function probe(url) {
  const t0 = Date.now();
  const out = { url, ok: false };
  try {
    let r = await readSome(url);
    out.status = r.status;
    out.contentType = r.headers['content-type'] || '';
    out.icyBr = r.headers['icy-br'] || null;
    out.cors = r.headers['access-control-allow-origin'] || null;
    if (new URL(r.finalUrl).protocol !== 'https:') out.redirectedToHttp = true;
    if (r.status >= 400) { out.error = `HTTP ${r.status}`; return out; }
    let s = sniff(r.bytes);
    if (s.kind === 'hls-playlist' || /mpegurl/i.test(out.contentType)) {
      out.hls = true;
      let pl = parseM3u8(r.bytes.toString('utf8'), r.finalUrl);
      if (pl.variants.length) {
        const v = pl.variants.sort((a, b) => a.bw - b.bw)[0];
        out.hlsCodecs = v.codecs; out.kbps = Math.round(v.bw / 1000);
        const r2 = await readSome(v.url); pl = parseM3u8(r2.bytes.toString('utf8'), r2.finalUrl);
      }
      if (!pl.segs.length) { out.error = 'hls: no segments'; return out; }
      const seg = await readSome(pl.segs[pl.segs.length - 1]);
      s = sniff(seg.bytes);
      if (s.kind !== 'audio' && seg.status < 400 && seg.bytes.length > 1000) s = { kind: 'audio', codec: 'HLS segment' };
    }
    if (out.redirectedToHttp) { out.error = 'redirects to http'; return out; }
    if (s.kind !== 'audio') { out.error = `not audio (${s.kind}, ${out.contentType || 'no content-type'})`; return out; }
    out.ok = true;
    out.codec = out.hls ? `HLS ${out.hlsCodecs || s.codec}` : s.codec;
    out.kbps = out.kbps || s.kbps || (out.icyBr ? Number(out.icyBr) : null);
    out.sampleRate = s.sampleRate;
  } catch (e) {
    const c = e.cause || e;
    out.error = (c.code || c.message || String(c)).slice(0, 80);
  } finally { out.ms = Date.now() - t0; }
  return out;
}

async function pool(items, n, fn) {
  const results = new Array(items.length); let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k]); if (++done % 50 === 0) console.log(`  probed ${done}/${items.length}`); }
  }));
  return results;
}

// ---------- CORS check against the directory ----------
async function corsCheck(host) {
  const r = await fetch(`https://${host}/json/stations/search?tag=jazz&limit=1`, { headers: { 'User-Agent': UA, Origin: 'https://example.github.io' } });
  const pre = await fetch(`https://${host}/json/stations/search`, { method: 'OPTIONS', headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'GET' } });
  return { host, getAllowOrigin: r.headers.get('access-control-allow-origin'), preflightStatus: pre.status, preflightAllowOrigin: pre.headers.get('access-control-allow-origin') };
}

// ---------- Main ----------
const genres = JSON.parse(await fs.readFile(path.join(ROOT, 'genres.json'), 'utf8'));
const servers = await getServers();
console.log('Radio Browser servers:', servers.join(', '));

let stations, usedHost = '(cache)';
try {
  const st = await fs.stat(CACHE);
  if (!REFRESH && Date.now() - st.mtimeMs < 24 * 3600e3) stations = JSON.parse(await fs.readFile(CACHE, 'utf8'));
} catch {}
if (!stations) {
  console.log('Downloading full station list (one big request)...');
  const { host, data } = await rb('/json/stations?hidebroken=false&limit=200000', servers);
  usedHost = host; stations = data;
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, JSON.stringify(stations));
}
console.log(`Stations in directory: ${stations.length}`);
for (const s of stations) s._tags = (s.tags || '').split(',').map(norm).filter(Boolean);

const rows = [];
const probeQueue = new Map(); // url -> null
function matcher(sg) {
  const rules = [compileRule({ ...sg, extra: undefined }), ...(sg.extra || []).map(e => compileRule({ ...e, names: [] }))];
  const exT = new Set((sg.excludeTags || []).map(norm)), exN = (sg.excludeNames || []).map(x => x.toLowerCase());
  return st => rules.some(r => ruleMatches(r, st)) && !st._tags.some(t => exT.has(t)) && !exN.some(x => (st.name || '').toLowerCase().includes(x));
}
const prefers = (cat, sg) => (sg.prefer || cat.prefer || []).map(x => x.toLowerCase());
const prefRank = (langs, st) => langs.length && langs.some(l => (st.language || '').toLowerCase().includes(l)) ? 1 : 0;
for (const cat of genres.categories) for (const sg of cat.subgenres) {
  const m = matcher(sg);
  const matched = stations.filter(m);
  const reasons = {}; const playable = new Map();
  for (const st of matched) {
    const why = playableReason(st);
    reasons[why] = (reasons[why] || 0) + 1;
    if (why === 'ok') { const u = st.url_resolved || st.url; if (!playable.has(u) || score(st) > score(playable.get(u))) playable.set(u, st); }
  }
  const langs = prefers(cat, sg);
  const ranked = [...playable.values()].sort((a, b) => prefRank(langs, b) - prefRank(langs, a) || score(b) - score(a));
  const top = ranked.slice(0, PROBE_N);
  for (const st of top) probeQueue.set(st.url_resolved || st.url, null);
  rows.push({ sg, category: cat.label, id: sg.id, label: sg.label, raw: matched.length, working: matched.length - (reasons['not-working'] || 0), reasons, playable: playable.size, top, ranked });
}

console.log(`Probing ${probeQueue.size} unique stream URLs (top ${PROBE_N} per sub-genre)...`);
const urls = [...probeQueue.keys()];
const probed = await pool(urls, CONCURRENCY, probe);
urls.forEach((u, i) => probeQueue.set(u, probed[i]));

// Soccer by language (all playable soccer stations; probe results where we have them)
const soccer = rows.find(r => r.id === 'soccer');
const langUrls = soccer.ranked.map(s => s.url_resolved || s.url).filter(u => !probeQueue.has(u));
if (langUrls.length) {
  console.log(`Probing ${langUrls.length} more soccer streams for the language breakdown...`);
  const extra = await pool(langUrls, CONCURRENCY, probe);
  langUrls.forEach((u, i) => probeQueue.set(u, extra[i]));
}
const langKey = st => {
  const lang = (st.language || '').split(/[,;/]/)[0].trim().toLowerCase() || 'unknown';
  const cc = (st.countrycode || '').toUpperCase();
  if (lang === 'english') return cc === 'GB' ? 'English (UK)' : cc === 'US' ? 'English (US)' : 'English (other)';
  return lang.charAt(0).toUpperCase() + lang.slice(1);
};
const byLang = {};
for (const st of soccer.ranked) {
  const k = langKey(st); byLang[k] ||= { playable: 0, verified: 0, names: [] };
  byLang[k].playable++;
  const p = probeQueue.get(st.url_resolved || st.url);
  if (p?.ok) { byLang[k].verified++; if (byLang[k].names.length < 4) byLang[k].names.push(st.name.trim()); }
}

// HTTP-only stations: would Safari's automatic http->https upgrade rescue them? Sample per sub-genre.
const httpSample = new Map();
for (const r of rows) {
  const http = stationsFor(r).filter(st => playableReason(st) === 'http-only').sort((a, b) => score(b) - score(a)).slice(0, 5);
  for (const st of http) { const u = (st.url_resolved || st.url).replace(/^http:/, 'https:'); httpSample.set(u, null); }
}
function stationsFor(r) { return stations.filter(matcher(r.sg)); }
console.log(`Probing ${httpSample.size} http-only streams with https swapped in (Safari's auto-upgrade)...`);
const hu = [...httpSample.keys()];
const hres = await pool(hu, CONCURRENCY, probe);
const upgradeOk = hres.filter(x => x.ok).length;

// ---------- Station snapshot shipped with the site (stations.json) ----------
// Per sub-genre: pinned stations first, then the top playable ones; every URL is probed
// and only streams that returned audio are kept.
const SNAP_N = 60;
const byUuid = new Map(stations.map(s => [s.stationuuid, s]));
const toHttps = u => u.replace(/^http:/i, 'https:');
const snapPlan = [];
for (const r of rows) {
  const list = [];
  for (const id of r.sg.pin || []) {
    const st = byUuid.get(id); if (!st) { console.warn(`  pinned station ${id} not in directory (${r.id})`); continue; }
    let u; try { u = new URL(toHttps(st.url_resolved || st.url)); } catch { continue; }
    if (!isIp(u.hostname)) list.push({ st, url: u.href, pinned: true });
  }
  for (const st of r.ranked) { if (list.length >= SNAP_N) break; if (!list.some(x => x.st.stationuuid === st.stationuuid)) list.push({ st, url: st.url_resolved || st.url }); }
  snapPlan.push({ id: r.id, list });
}
const needProbe = [...new Set(snapPlan.flatMap(p => p.list.map(x => x.url)))].filter(u => !probeQueue.get(u));
console.log(`Probing ${needProbe.length} more streams for the station snapshot...`);
const snapRes = await pool(needProbe, CONCURRENCY, probe);
needProbe.forEach((u, i) => probeQueue.set(u, snapRes[i]));
const snapshot = { built: new Date().toISOString(), subgenres: {}, stations: {} };
const httpsFav = f => (f && /^https:\/\//i.test(f) ? f : '');
for (const p of snapPlan) {
  snapshot.subgenres[p.id] = [];
  for (const { st, url, pinned } of p.list) {
    const pr = probeQueue.get(url); if (!pr?.ok) continue;
    snapshot.subgenres[p.id].push(st.stationuuid);
    snapshot.stations[st.stationuuid] ||= {
      n: st.name.trim(), u: url, f: httpsFav(st.favicon), c: st.countrycode || '', l: (st.language || '').split(',')[0].trim(),
      t: st._tags.slice(0, 6), k: pr.codec, b: pr.kbps || st.bitrate || 0, s: Math.round(score(st)), ...(pinned ? { p: 1 } : {}),
    };
  }
}
await fs.writeFile(path.join(ROOT, 'stations.json'), JSON.stringify(snapshot));
console.log(`stations.json: ${Object.keys(snapshot.stations).length} stations; per sub-genre: ` + Object.entries(snapshot.subgenres).map(([k, v]) => `${k} ${v.length}`).join(', '));

let cors = [];
for (const h of servers) { try { cors.push(await corsCheck(h)); } catch (e) { cors.push({ host: h, error: e.message }); } }

// ---------- Report ----------
for (const r of rows) {
  const res = r.top.map(st => probeQueue.get(st.url_resolved || st.url));
  r.probed = res.length; r.verified = res.filter(x => x?.ok).length;
  r.streamCors = res.filter(x => x?.ok && x.cors).length;
  r.codecs = {}; for (const x of res.filter(x => x?.ok)) { const k = x.codec.replace(/^HLS .*/, 'HLS'); r.codecs[k] = (r.codecs[k] || 0) + 1; }
  r.medianKbps = (() => { const k = res.filter(x => x?.ok && x.kbps).map(x => x.kbps).sort((a, b) => a - b); return k.length ? k[Math.floor(k.length / 2)] : null; })();
  r.fails = {}; for (const x of res.filter(x => x && !x.ok)) { const k = x.error.replace(/\(.*\)/, '').trim(); r.fails[k] = (r.fails[k] || 0) + 1; }
}
const totalReasons = {};
for (const r of rows) for (const [k, v] of Object.entries(r.reasons)) totalReasons[k] = (totalReasons[k] || 0) + v;

const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
let md = `# Station audit\n\nRun: ${new Date().toISOString()} · directory: ${stations.length} stations · servers listed: ${servers.join(', ')}\n\n`;
md += `**Raw** = stations whose tags map to the sub-genre. **Working** = directory says its last check passed. **Playable** = working + https + domain name (not an IP) + MP3/AAC/HLS, de-duplicated by stream URL. **Verified** = of the top ${PROBE_N} playable (by votes and recent clicks), how many actually returned audio bytes from this Mac.\n\n`;
md += `| Category | Sub-genre | Raw | Working | Playable | Verified / probed | Median kbps | Codecs (verified) |\n|---|---|--:|--:|--:|--:|--:|---|\n`;
for (const r of rows) md += `| ${r.category} | ${r.label} | ${r.raw} | ${r.working} | ${r.playable} | ${r.verified} / ${r.probed} | ${r.medianKbps ?? '—'} | ${fmt(r.codecs)} |\n`;
md += `\n## Why stations were dropped (summed across sub-genres)\n\n${fmt(totalReasons)}\n\n`;
md += `Safari auto-upgrade test: ${upgradeOk} of ${hu.length} http-only streams (top 5 per sub-genre) answered with audio when switched to https.\n\n`;
md += `## Probe failures by sub-genre\n\n| Sub-genre | Failures |\n|---|---|\n`;
for (const r of rows) md += `| ${r.label} | ${fmt(r.fails)} |\n`;
md += `\n## Soccer by language (all playable soccer stations probed)\n\n| Language | Playable | Verified | Examples |\n|---|--:|--:|---|\n`;
for (const [k, v] of Object.entries(byLang).sort((a, b) => b[1].verified - a[1].verified)) md += `| ${k} | ${v.playable} | ${v.verified} | ${v.names.join('; ')} |\n`;
md += `\n## Directory CORS\n\n\`\`\`json\n${JSON.stringify(cors, null, 2)}\n\`\`\`\n`;
md += `\nStreams that sent an Access-Control-Allow-Origin header (needed only if we ever analyse audio levels): ${rows.reduce((a, r) => a + r.streamCors, 0)} of ${rows.reduce((a, r) => a + r.verified, 0)} verified probes.\n`;

const results = rows.map(r => ({ id: r.id, label: r.label, raw: r.raw, working: r.working, playable: r.playable, verified: r.verified, probed: r.probed,
  top: r.top.map(st => ({ name: st.name.trim(), uuid: st.stationuuid, url: st.url_resolved || st.url, country: st.countrycode, language: st.language, votes: st.votes, clicks: st.clickcount, probe: probeQueue.get(st.url_resolved || st.url) })) }));
await fs.writeFile(path.join(ROOT, 'audit', 'results.json'), JSON.stringify({ when: new Date().toISOString(), byLang, cors, upgrade: { tried: hu.length, ok: upgradeOk, results: hres }, results }, null, 1));
await fs.writeFile(path.join(ROOT, 'audit', 'report.md'), md);
console.log('\n' + md);
