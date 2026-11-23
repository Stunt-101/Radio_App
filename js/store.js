// Everything saved on this device: favorites, recents, hidden stations, last station,
// failure memory and cached station lists. All reads/writes tolerate a missing or
// blocked localStorage (private browsing), so the site still works, just without memory.

const PREFIX = 'carradio.';

function read(key, fallback) {
  try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

// A station as stored: { id, name, url, favicon, country, language, tags, codec, bitrate, sg }
export const slim = st => ({
  id: st.id, name: st.name, url: st.url, favicon: st.favicon || '', country: st.country || '',
  language: st.language || '', tags: st.tags || [], codec: st.codec || '', bitrate: st.bitrate || 0, sg: st.sg || '',
});

// ---------- Favorites ----------
// Favorite = station + { group, added, lastPlayed, broken (timestamp or 0) }
export const favorites = {
  list() { return read('favorites', []); },
  save(list) { write('favorites', list); },
  has(id) { return this.list().some(f => f.id === id); },
  get(id) { return this.list().find(f => f.id === id); },
  toggle(st) {
    const list = this.list();
    const i = list.findIndex(f => f.id === st.id);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ ...slim(st), group: '', added: Date.now(), lastPlayed: Date.now(), broken: 0 });
    this.save(list);
    return i < 0;
  },
  update(id, patch) {
    const list = this.list(); const f = list.find(x => x.id === id);
    if (f) { Object.assign(f, patch); this.save(list); }
  },
  // "recent" = most recently played first; "custom" = the order you arranged
  get order() { return read('favOrder', 'recent'); },
  set order(v) { write('favOrder', v); },
  sorted(group) {
    let list = this.list();
    if (this.order === 'recent') list = [...list].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    return group ? list.filter(f => f.group === group) : list;
  },
  groups() { return [...new Set(this.list().map(f => f.group).filter(Boolean))].sort(); },
  move(id, toIndex) {
    const list = this.list(); const i = list.findIndex(f => f.id === id);
    if (i < 0) return;
    const [f] = list.splice(i, 1); list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, f);
    this.save(list); this.order = 'custom';
  },
};

// ---------- Recents, hidden, last station ----------
export const recents = {
  list() { return read('recents', []); },
  add(st) {
    const list = this.list().filter(r => r.id !== st.id);
    list.unshift({ ...slim(st), at: Date.now() });
    write('recents', list.slice(0, 30));
  },
};

export const hidden = {
  list() { return read('hidden', []); },
  has(id) { return this.list().some(h => h.id === id); },
  add(st) { if (!this.has(st.id)) write('hidden', [{ id: st.id, name: st.name }, ...this.list()]); },
  remove(id) { write('hidden', this.list().filter(h => h.id !== id)); },
};

export const last = {
  get() { return read('last', null); },           // { station, sg, fromFavorites }
  set(v) { write('last', v); },
};

// Stations that failed recently on this device sink to the bottom of lists for a day.
export const failures = {
  all() { return read('failures', {}); },
  recent(id) { const t = this.all()[id]; return t && Date.now() - t < 24 * 3600e3; },
  mark(id) { const a = this.all(); a[id] = Date.now(); write('failures', a); },
  clear(id) { const a = this.all(); if (a[id]) { delete a[id]; write('failures', a); } },
};

export const prefs = {
  get(key, fallback) { return read('pref.' + key, fallback); },
  set(key, value) { write('pref.' + key, value); },
};

// ---------- Cache for live directory results ----------
export const cache = {
  get(key, maxAgeMs) {
    const v = read('cache.' + key, null);
    return v && Date.now() - v.at < maxAgeMs ? v.data : null;
  },
  set(key, data) {
    if (!write('cache.' + key, { at: Date.now(), data })) {
      // Storage full: drop old caches (never favorites) and try once more.
      try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX + 'cache.')).forEach(k => localStorage.removeItem(k)); } catch {}
      write('cache.' + key, { at: Date.now(), data });
    }
  },
};

// ---------- Export / import ----------
export function exportData() {
  return JSON.stringify({
    app: 'car-radio', version: 1, exported: new Date().toISOString(),
    favorites: favorites.list(), favOrder: favorites.order, hidden: hidden.list(), recents: recents.list(),
  }, null, 1);
}

// Merges, never deletes: favorites/hidden from the file are added if missing.
export function importData(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'car-radio' || !Array.isArray(data.favorites)) throw new Error('This is not a Car Radio backup file.');
  const favs = favorites.list(); let added = 0;
  for (const f of data.favorites) {
    if (!f || !f.id || !f.url) continue;
    const mine = favs.find(x => x.id === f.id);
    if (mine) { if (!mine.group && f.group) mine.group = f.group; }
    else { favs.push(f); added++; }
  }
  favorites.save(favs);
  for (const h of data.hidden || []) if (h && h.id) hidden.add(h);
  return { added, total: favs.length };
}
