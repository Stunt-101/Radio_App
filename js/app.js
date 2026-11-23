// Screens and taps. Routes: #/ (Home), #/c/<category>, #/now, #/menu, #/search,
// #/favs (arrange favorites), #/hidden.

import * as dir from './directory.js';
import { favorites, hidden, last, prefs, exportData, importData } from './store.js';
import { Player } from './player.js';

const $ = sel => document.querySelector(sel);
const screen = $('#screen');
const player = new Player($('#audio'));
window.carRadio = { player, dir }; // handy for debugging in Safari's Web Inspector
let favGroup = prefs.get('favGroup', '');
const pendingRefresh = new Set();

// ---------- Icons ----------
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.2"/><rect x="14" y="4" width="5" height="16" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="3" height="16" rx="1"/><path d="M21 4.8v14.4a1 1 0 0 1-1.5.86L8.4 13a1.2 1.2 0 0 1 0-2l11.1-7.06A1 1 0 0 1 21 4.8z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="18" y="4" width="3" height="16" rx="1"/><path d="M3 4.8v14.4a1 1 0 0 0 1.5.86L15.6 13a1.2 1.2 0 0 0 0-2L4.5 3.94A1 1 0 0 0 3 4.8z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 9 2.4C21 15 12 20.5 12 20.5z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 9 2.4C21 15 12 20.5 12 20.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logo = (st, cls = 'logo') => `<span class="${cls}">${st.favicon ? `<img src="${esc(st.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith('📻')">` : '📻'}</span>`;
const codecLabel = c => (/^HLS/i.test(c || '') ? 'HLS' : /AAC|MP4/i.test(c || '') ? 'AAC' : /MP3/i.test(c || '') ? 'MP3' : '');
const meta = st => {
  const c = codecLabel(st.codec), kbps = st.bitrate > 0 && st.bitrate <= 320 ? `${st.bitrate}k` : '';
  return [st.country, st.language, [c, kbps].filter(Boolean).join(' ')].filter(Boolean).map(esc).join(' · ');
};
const backBtn = '<button class="icon-btn" data-action="back" aria-label="Back">' + I.back + '</button>';

// ---------- Playing things ----------
function playSubgenre(sgId, startId) {
  const sg = dir.subgenre(sgId);
  const list = dir.stationsFor(sgId);
  // Test switch: open the site with ?test=dead to put a broken station first and watch it get skipped.
  if (new URLSearchParams(location.search).get('test') === 'dead' && !startId)
    list.unshift({ id: 'test-dead', name: 'Test dead station', url: 'https://dead-station.invalid/stream.mp3', tags: [], sg: sgId });
  const i = startId ? Math.max(0, list.findIndex(s => s.id === startId)) : 0;
  player.play(list, i, { type: 'sg', sgId, label: `${sg.category.label} · ${sg.label}` });
  pendingRefresh.add(sgId);
  go('#/now');
}

function playFavorite(id) {
  const list = favorites.sorted(favGroup);
  const i = list.findIndex(f => f.id === id);
  player.play(list, Math.max(0, i), { type: 'fav', group: favGroup, label: favGroup ? `Favorites · ${favGroup}` : 'Favorites' });
  go('#/now');
}

function playOne(st, label) {
  player.play([st], 0, { type: 'one', label });
  go('#/now');
}

function resumeLast() {
  const l = last.get(); if (!l) return;
  const src = l.source || {};
  if (src.type === 'sg' && dir.subgenre(src.sgId)) {
    const list = dir.stationsFor(src.sgId);
    if (!list.some(s => s.id === l.station.id)) list.unshift(l.station);
    player.play(list, list.findIndex(s => s.id === l.station.id), src);
  } else if (src.type === 'fav' && favorites.has(l.station.id)) {
    favGroup = src.group || ''; playFavorite(l.station.id); return;
  } else player.play([l.station], 0, src.label ? src : { type: 'one', label: 'Last played' });
  go('#/now');
}

// A favorite (or a lone station) that won't play: mark it, then play something similar.
player.onDead = (st, source) => {
  if (source && source.type === 'fav') favorites.update(st.id, { broken: Date.now() });
  if (source && (source.type === 'fav' || source.type === 'one')) {
    const similar = dir.similarTo(st);
    if (similar.length) {
      const sg = st.sg && dir.subgenre(st.sg);
      return { queue: similar, index: 0, source: sg ? { type: 'sg', sgId: sg.id, label: `${sg.category.label} · ${sg.label}` } : { type: 'one', label: 'Similar station' },
        notice: `${st.name} isn't working right now. Playing a similar station.` };
    }
  }
  return null;
};

player.on(p => {
  const st = p.station;
  if (p.status === 'playing' && st) {
    if (favorites.has(st.id)) favorites.update(st.id, { lastPlayed: Date.now(), broken: 0 });
    // Freshen this sub-genre from the live directory a few seconds after audio starts.
    if (p.source?.type === 'sg' && pendingRefresh.delete(p.source.sgId)) {
      const id = p.source.sgId;
      setTimeout(() => dir.refresh(id).then(() => mergeLive(id)), 4000);
    }
  }
  updatePlayerUI();
});

// After a live refresh, extend the current queue without disturbing what's playing.
function mergeLive(sgId) {
  if (player.source?.type !== 'sg' || player.source.sgId !== sgId) return;
  const have = new Set(player.queue.map(s => s.id));
  const extra = dir.stationsFor(sgId).filter(s => !have.has(s.id));
  if (extra.length) { player.queue.push(...extra); if (route().name === 'now') render(); }
}

// ---------- Routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  return { name: name || 'home', arg: arg && decodeURIComponent(arg) };
}
let navDepth = 0; // in-app history depth, so Back never leaves the site
function go(hash) { if (location.hash !== hash) { navDepth++; location.hash = hash; } else render(); }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function render() {
  const r = route();
  const views = { home: viewHome, c: viewCategory, now: viewNow, menu: viewMenu, search: viewSearch, favs: viewArrange, hidden: viewHidden };
  screen.innerHTML = (views[r.name] || viewHome)(r.arg);
  if (r.name === 'now' && player.station) shownStationId = player.station.id + ':' + player.index + ':' + player.queue.length;
  if (r.name === 'search') { const inp = $('#q'); if (inp && !inp.value) inp.focus(); }
  if (r.name === 'favs') wireDrag();
  updatePlayerUI();
}

// ---------- Views ----------
function viewHome() {
  const cats = dir.categories();
  const l = last.get();
  const showResume = l && l.station && (!player.station || player.status === 'idle');
  const groups = favorites.groups();
  if (favGroup && !groups.includes(favGroup)) favGroup = '';
  const favs = favorites.sorted(favGroup);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return `
    <div class="bar"><h1>Car Radio</h1><button class="icon-btn" data-action="go" data-to="#/menu" aria-label="Menu">•••</button></div>
    ${standalone ? '<div class="banner bad">Opened from the Home Screen, audio stops when you switch apps. Open this site in a Safari tab instead.</div>' : ''}
    ${showResume ? `<button class="resume" data-action="resume">${I.play}<span><span class="lbl">Resume</span><span class="nm" style="display:block">${esc(l.station.name)}</span></span></button>` : ''}
    <div class="tiles">
      ${cats.map(c => `<button class="tile ${c.id}" data-action="go" data-to="#/c/${c.id}"><span class="emoji" aria-hidden="true">${c.icon || ''}</span>${esc(c.label)}</button>`).join('')}
    </div>
    <h2>Favorites</h2>
    ${groups.length ? `<div class="chips" role="group" aria-label="Filter favorites">
      <button class="chip" data-action="group" data-group="" aria-pressed="${!favGroup}">All</button>
      ${groups.map(g => `<button class="chip" data-action="group" data-group="${esc(g)}" aria-pressed="${favGroup === g}">${esc(g)}</button>`).join('')}
    </div>` : ''}
    ${favs.length ? `<div class="favs">${favs.map(f => `
      <button class="fav ${player.station?.id === f.id && player.wantPlaying ? 'playing' : ''}" data-action="fav" data-id="${esc(f.id)}">
        ${logo(f)}<span><span class="nm">${esc(f.name)}</span>${f.broken ? '<span class="warn">Not working lately</span>' : ''}</span>
      </button>`).join('')}</div>`
      : '<p class="hint">Tap the ♥ on any station to put it here. One tap plays it.</p>'}
  `;
}

function viewCategory(id) {
  const c = dir.category(id);
  if (!c) return viewHome();
  return `
    <div class="bar">${backBtn}<h1>${esc(c.label)}</h1></div>
    <div class="tiles sub">
      ${c.subgenres.map(sg => `<button class="tile ${c.id}" data-action="sg" data-id="${sg.id}">${esc(sg.label)}</button>`).join('')}
    </div>
    <p class="note">Tap a tile and the best working station starts right away. Use the arrows on the next screen to change station.</p>
  `;
}

function viewNow() {
  const st = player.station;
  if (!st) return `<div class="bar">${backBtn}<h1>Now Playing</h1></div><p class="hint">Nothing playing yet. Go back and tap a tile.</p>`;
  const isFav = favorites.has(st.id);
  return `
    <div class="bar">${backBtn}<h1 style="font-size:22px;color:var(--muted)">${esc(player.source?.label || 'Now Playing')}</h1></div>
    <div class="now">
      <section>
        ${logo(st, 'logo now-logo')}
        <div class="now-name" id="now-name">${esc(st.name)}</div>
        <div class="now-sub" id="now-sub">${meta(st)}${player.queue.length > 1 ? ` · ${player.index + 1} of ${player.queue.length}` : ''}</div>
        <div class="now-status" id="now-status"></div>
        <div class="controls">
          <button class="ctl" data-action="prev" aria-label="Previous station">${I.prev}</button>
          <button class="ctl main" id="now-toggle" data-action="toggle" aria-label="Play or pause"></button>
          <button class="ctl" data-action="next" aria-label="Next station">${I.next}</button>
        </div>
        <div class="actions">
          <button class="act ${isFav ? 'on' : ''}" data-action="heart" data-id="${esc(st.id)}" aria-pressed="${isFav}">${isFav ? I.heartOn : I.heart}${isFav ? 'Saved' : 'Save'}</button>
          <button class="act" data-action="hide-current">${I.hide}Never show</button>
        </div>
      </section>
      ${player.queue.length > 1 ? `<section class="now-list"><h2 style="margin-top:0">More stations</h2>${stationList(player.queue, { current: player.index, play: 'queue' })}</section>` : ''}
    </div>
  `;
}

function stationList(list, { current = -1, play = 'queue' } = {}) {
  return `<div class="list">${list.map((st, i) => {
    const on = favorites.has(st.id);
    return `<div class="row">
      <button class="play-row ${i === current ? 'current' : ''}" data-action="${play === 'queue' ? 'play-index' : 'play-result'}" data-i="${i}">
        ${logo(st)}<span><span class="nm">${esc(st.name)}</span><span class="meta">${meta(st)}</span></span>
      </button>
      <button class="heart ${on ? 'on' : ''}" data-action="heart-list" data-i="${i}" data-list="${play}" aria-label="${on ? 'Remove from' : 'Add to'} favorites" aria-pressed="${on}">${on ? I.heartOn : I.heart}</button>
    </div>`;
  }).join('')}</div>`;
}

function viewMenu() {
  return `
    <div class="bar">${backBtn}<h1>Menu</h1></div>
    <p class="note">For when you're parked.</p>
    <div class="menu">
      <button data-action="go" data-to="#/search">🔍 Search all stations</button>
      <button data-action="go" data-to="#/favs">♥ Arrange and group favorites</button>
      <button data-action="export">⬆︎ Export favorites (backup or copy to iPad)</button>
      <label class="file">⬇︎ Import favorites from a file<input type="file" accept="application/json,.json,.txt" data-action="import-file"></label>
      <button data-action="import-paste">📋 Import by pasting text</button>
      <button data-action="go" data-to="#/hidden">⊘ Hidden stations (${hidden.list().length})</button>
      <button data-action="about">ⓘ How to use in the car</button>
    </div>
  `;
}

let searchResults = [];
function viewSearch() {
  return `
    <div class="bar">${backBtn}<h1>Search</h1></div>
    <form class="search-form" data-action="search">
      <input id="q" type="search" placeholder="Station name" autocomplete="off" autocapitalize="off" enterkeyhint="search" value="${esc(prefs.get('lastSearch', ''))}">
      <button type="submit">Go</button>
    </form>
    <div id="results">${searchResults.length ? stationList(searchResults, { play: 'results' }) : '<p class="hint">Search the whole directory by station name, e.g. "BBC", "ESPN", "Bloomberg".</p>'}</div>
  `;
}

function viewArrange() {
  const list = favorites.list();
  const order = favorites.order;
  const shown = order === 'recent' ? favorites.sorted('') : list;
  return `
    <div class="bar">${backBtn}<h1>Favorites</h1></div>
    <div class="seg" role="group" aria-label="Order">
      <button data-action="order" data-order="recent" aria-pressed="${order === 'recent'}">Recently played</button>
      <button data-action="order" data-order="custom" aria-pressed="${order === 'custom'}">My order</button>
    </div>
    ${order === 'custom' ? '<p class="note">Drag ☰ to move a station. A group lets you filter the Home screen in one tap.</p>' : '<p class="note">Switch to "My order" to arrange them by dragging.</p>'}
    ${shown.length ? `<div class="list" id="arrange">${shown.map(f => `
      <div class="row" data-id="${esc(f.id)}">
        ${order === 'custom' ? '<span class="handle" aria-hidden="true">☰</span>' : ''}
        <button class="play-row" data-action="fav" data-id="${esc(f.id)}">${logo(f)}<span><span class="nm">${esc(f.name)}</span><span class="meta">${f.broken ? '⚠︎ Not working lately · ' : ''}${esc(f.group || 'No group')}</span></span></button>
        <button class="side-btn" data-action="set-group" data-id="${esc(f.id)}" aria-label="Group or remove ${esc(f.name)}">•••</button>
      </div>`).join('')}</div>` : '<p class="hint">No favorites yet.</p>'}
  `;
}

function viewHidden() {
  const list = hidden.list();
  return `
    <div class="bar">${backBtn}<h1>Hidden</h1></div>
    ${list.length ? `<div class="list">${list.map(h => `<div class="row"><span class="play-row"><span><span class="nm">${esc(h.name)}</span></span></span>
      <button class="side-btn" data-action="unhide" data-id="${esc(h.id)}">Show again</button></div>`).join('')}</div>`
      : '<p class="hint">No hidden stations. Tap "Never show" on Now Playing to hide one for good.</p>'}
  `;
}

// ---------- Player UI updates (no full re-render, keeps scroll position) ----------
function statusText(p) {
  if (p.status === 'loading') return p.notice || 'Connecting…';
  if (p.status === 'playing') return p.notice || 'Live';
  if (p.status === 'paused') return p.notice || 'Paused';
  if (p.status === 'failed') return p.notice;
  return '';
}
let shownStationId = null;
function updatePlayerUI() {
  const p = player, st = p.station;
  const playingIcon = p.wantPlaying ? I.pause : I.play;
  const mini = $('#mini');
  const showMini = st && p.status !== 'idle' && route().name !== 'now';
  mini.hidden = !showMini;
  document.body.classList.toggle('has-mini', !!showMini);
  if (st) {
    $('#mini-name').textContent = st.name;
    $('#mini-status').textContent = statusText(p);
    $('#mini-toggle').innerHTML = playingIcon;
  }
  if (route().name === 'now') {
    if (st && shownStationId !== st.id + ':' + p.index + ':' + p.queue.length && $('#now-name')) { shownStationId = st.id + ':' + p.index + ':' + p.queue.length; screen.innerHTML = viewNow(); }
    const s = $('#now-status');
    if (s) { s.textContent = statusText(p); s.classList.toggle('bad', p.status === 'failed'); }
    const t = $('#now-toggle'); if (t) t.innerHTML = playingIcon;
    document.title = st ? `${p.wantPlaying ? '▶ ' : ''}${st.name} · Car Radio` : 'Car Radio';
  }
}

// ---------- Sheets (pop-ups) ----------
function sheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-body" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

function aboutSheet() {
  sheet(`<h3>Using Car Radio in the car</h3>
    <p><strong>Keep it in a Safari tab.</strong> Audio keeps playing with the screen locked, and the lock screen shows play/pause and next/previous. Don't add it to the Home Screen: a Home Screen web app stops playing when you switch apps.</p>
    <p><strong>Safari needs one tap to start sound.</strong> Tap Resume or a favorite to start.</p>
    <p>If a station doesn't play, the app moves to the next one by itself.</p>
    <p>Favorites are saved on this device only. Use <strong>Menu → Export</strong> now and then as a backup, and to copy them to your iPad.</p>
    <button class="primary" data-action="close-sheet">Got it</button>`);
}

function groupSheet(id) {
  const f = favorites.get(id); if (!f) return;
  const groups = [...new Set([...favorites.groups(), 'Soccer', 'News', 'Music'])];
  sheet(`<h3>${esc(f.name)}</h3><p>Pick a group. Groups let you filter favorites on the Home screen with one tap.</p>
    <div class="menu">
      ${groups.map(g => `<button data-action="pick-group" data-id="${esc(id)}" data-group="${esc(g)}">${f.group === g ? '✓ ' : ''}${esc(g)}</button>`).join('')}
      <button data-action="pick-group" data-id="${esc(id)}" data-group="__new">＋ New group…</button>
      <button data-action="pick-group" data-id="${esc(id)}" data-group="">${!f.group ? '✓ ' : ''}No group</button>
      <button data-action="unfav" data-id="${esc(id)}" style="color:var(--danger)">♥ Remove from favorites</button>
    </div>`);
}

async function doExport() {
  const text = exportData();
  const name = `car-radio-favorites-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Car Radio favorites' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  try { await navigator.clipboard.writeText(text); } catch {}
  sheet(`<h3>Exported</h3><p>Saved as <strong>${esc(name)}</strong> in Downloads${navigator.clipboard ? ', and copied to the clipboard' : ''}. On the other device, open Menu → Import.</p><button class="primary" data-action="close-sheet">OK</button>`);
}

function doImport(text) {
  try {
    const { added, total } = importData(text);
    sheet(`<h3>Imported</h3><p>Added <strong>${added}</strong> new favorite${added === 1 ? '' : 's'}. You now have ${total}. Nothing was removed.</p><button class="primary" data-action="close-sheet">OK</button>`);
  } catch (e) {
    sheet(`<h3>Couldn't import</h3><p>${esc(e.message || 'That file could not be read.')}</p><button class="primary" data-action="close-sheet">OK</button>`);
  }
}

// ---------- Taps ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action;
  const queueList = () => (el.dataset.list === 'results' ? searchResults : player.queue);
  switch (a) {
    case 'go': go(el.dataset.to); break;
    case 'go-now': go('#/now'); break;
    case 'back': if (navDepth > 0) { navDepth--; history.back(); } else { location.replace('#/'); } break;
    case 'sg': playSubgenre(el.dataset.id); break;
    case 'fav': playFavorite(el.dataset.id); break;
    case 'resume': resumeLast(); break;
    case 'toggle': player.station ? player.toggle() : resumeLast(); break;
    case 'prev': player.step(-1); break;
    case 'next': player.step(1); break;
    case 'play-index': player.index = Number(el.dataset.i); player.skips = 0; player.notice = ''; player.start(); break;
    case 'play-result': playOne(searchResults[Number(el.dataset.i)], 'Search'); break;
    case 'heart': { const st = player.station; if (st) { favorites.toggle(st); shownStationId = null; render(); } break; }
    case 'heart-list': { const st = queueList()[Number(el.dataset.i)]; if (st) { favorites.toggle(st); const y = scrollY; render(); scrollTo(0, y); } break; }
    case 'hide-current': {
      const st = player.station; if (!st) break;
      hidden.add(st);
      player.queue.splice(player.index, 1);
      if (player.queue.length) { player.index %= player.queue.length; player.notice = `Hidden ${st.name}.`; player.start(); }
      else player.stop();
      shownStationId = null; render(); break;
    }
    case 'unhide': hidden.remove(el.dataset.id); render(); break;
    case 'group': favGroup = el.dataset.group; prefs.set('favGroup', favGroup); render(); break;
    case 'order': favorites.order = el.dataset.order; render(); break;
    case 'set-group': groupSheet(el.dataset.id); break;
    case 'pick-group': {
      let g = el.dataset.group;
      if (g === '__new') { g = (prompt('Name for the new group (e.g. Soccer)') || '').trim().slice(0, 24); if (!g) break; }
      favorites.update(el.dataset.id, { group: g }); closeSheet(); render(); break;
    }
    case 'unfav': { const f = favorites.get(el.dataset.id); if (f && confirm(`Remove ${f.name} from favorites?`)) { favorites.toggle(f); closeSheet(); render(); } break; }
    case 'export': doExport(); break;
    case 'import-paste':
      sheet(`<h3>Paste a backup</h3><textarea id="paste" placeholder="Paste the exported text here"></textarea>
        <button class="primary" data-action="import-pasted">Import</button>`); break;
    case 'import-pasted': doImport($('#paste').value); break;
    case 'about': aboutSheet(); break;
    case 'close-sheet': closeSheet(); render(); break;
  }
});

document.addEventListener('change', async e => {
  if (e.target.dataset.action === 'import-file' && e.target.files[0]) { doImport(await e.target.files[0].text()); e.target.value = ''; }
});

document.addEventListener('submit', async e => {
  if (e.target.dataset.action !== 'search') return;
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  prefs.set('lastSearch', q);
  $('#q').blur();
  $('#results').innerHTML = '<p class="hint">Searching…</p>';
  try { searchResults = await dir.search(q); $('#results').innerHTML = searchResults.length ? stationList(searchResults, { play: 'results' }) : '<p class="hint">No playable stations found.</p>'; }
  catch { $('#results').innerHTML = '<p class="hint">The station directory didn\'t answer. Try again in a moment.</p>'; }
});

// ---------- Drag to arrange favorites ----------
function wireDrag() {
  const box = $('#arrange'); if (!box || favorites.order !== 'custom') return;
  let dragRow = null;
  box.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle'); if (!h) return;
    dragRow = h.closest('.row'); dragRow.classList.add('dragging');
    h.setPointerCapture(e.pointerId); e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!dragRow) return;
    const rows = [...box.children].filter(r => r !== dragRow);
    const after = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    if (after) box.insertBefore(dragRow, after); else box.appendChild(dragRow);
  });
  const end = () => {
    if (!dragRow) return;
    dragRow.classList.remove('dragging'); dragRow = null;
    const ids = [...box.children].map(r => r.dataset.id);
    const byId = new Map(favorites.list().map(f => [f.id, f]));
    favorites.save(ids.map(id => byId.get(id)).filter(Boolean));
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}

// ---------- Start ----------
(async () => {
  try { await dir.load(); }
  catch { screen.innerHTML = '<p class="banner bad">Couldn\'t load the station list. Check the connection and reload.</p>'; return; }
  render();
  if (!prefs.get('seenAbout', false)) { prefs.set('seenAbout', true); aboutSheet(); }
})();
