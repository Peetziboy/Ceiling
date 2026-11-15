// =====================================================================
// FlightPrep – Flugvorbereitung (Modul Wetter: Ceiling)
// Keine amtliche Flugwetterberatung.
// =====================================================================

// ---------- Speicher: an EINER Stelle, damit er später austauschbar ist ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ---------- Symbole (schlichte Linien-SVGs) ----------
const icon = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  cloud: icon('<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/><path d="M3 21h18" stroke-dasharray="2 2.5"/>'),
  route: icon('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
  plane: icon('<path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/>'),
  gear: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Konstanten ----------
const DATA = 'data/';  // METAR, TAF, Flugplätze – von GitHub alle 15 min neben die App gelegt (Quelle: aviationweather.gov, OurAirports)
const OM = 'https://api.open-meteo.com/v1/forecast';     // Modellvorhersage (u. a. DWD ICON)
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600]; // Druckflächen in hPa
const H = 3600e3, SPAN = 48, FT = 3.28084;
const DEFAULTS = { minCeil: 1500, minVis: 5, maxWind: 20, maxGust: 25 };
const settings = () => ({ ...DEFAULTS, ...store.get('settings', {}) });
const AIRCRAFT = {
  C152: { name: 'Cessna C152', tas: 100, burn: 23, fuel: 'AvGas 100LL' },
  C172: { name: 'Cessna C172', tas: 115, burn: 34, fuel: 'AvGas 100LL' },
  PS28: { name: 'PS-28 Cruiser', tas: 110, burn: 18, fuel: 'MoGas / AvGas (Rotax 912)' },
  PA28: { name: 'Piper PA-28', tas: 115, burn: 34, fuel: 'AvGas 100LL' },
  SR22: { name: 'Cirrus SR22', tas: 170, burn: 60, fuel: 'AvGas 100LL' },
  TB20: { name: 'Socata TB-20 Trinidad', tas: 150, burn: 45, fuel: 'AvGas 100LL' },
  DA40: { name: 'Diamond DA40 NG', tas: 130, burn: 23, fuel: 'Jet A-1 (Diesel)' },
};
const PLAN_DEFAULTS = { ac: 'C172', corridor: 10, alt: 3500, depDay: 0, depTime: '', allow: 8, stop: 0, reserve: 30, taxi: 3, useWind: true, custom: {} };
const plan = () => {
  const p = { ...PLAN_DEFAULTS, ...store.get('plan', {}) };
  const a = AIRCRAFT[p.ac] || AIRCRAFT.C172, c = (p.custom || {})[p.ac] || {};
  return { ...p, custom: p.custom || {}, acData: a, tas: c.tas ?? a.tas, burn: c.burn ?? a.burn };
};

let F = store.get('briefing', null); // letzter Flug (bleibt auch offline sichtbar)
let V = store.get('wxView', null);   // letzte Einzelplatz-Ansicht
let B = F;                           // Daten der gerade sichtbaren Ansicht
let loading = false;                 // 'flug' | 'wx' | false
let sel = 0;                         // gewählte Stunde 0..47

// ---------- Hilfen für Zeit und Format ----------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const p2 = (n) => String(n).padStart(2, '0');
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (/^\d+$/.test(v)) return toMs(Number(v));
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z';
  const t = Date.parse(s); return isNaN(t) ? null : t;
}
const utc = (t) => { const d = new Date(t); return `${WD[d.getUTCDay()]} ${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}. ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`; };
const hhmm = (t) => { const d = new Date(t); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const local = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtCeil = (v) => v == null ? '–' : v === Infinity ? 'keine' : `${Math.round(v / 100) * 100} ft`;
const fmtVis = (v) => v == null ? '–' : v >= 10 ? '≥ 10 km' : `${v.toFixed(v < 5 ? 1 : 0)} km`;
const fmtWind = (w) => w?.wspd == null ? '–' : `${w.wdir === 'VRB' || w.wdir == null ? 'VRB' : p2(Math.round(w.wdir / 10) * 10).padStart(3, '0') + '°'} ${Math.round(w.wspd)} kt${w.wgst ? ' G' + Math.round(w.wgst) : ''}`;

function distKm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

// Sonnenhöhe in Grad (Näherung, auf ca. 1–2 Minuten genau)
function sunAlt(lat, lon, t) {
  const r = Math.PI / 180, d = t / 864e5 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * r, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, e = (23.439 - 3.6e-7 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = ((18.697374558 + 24.06570982441908 * d) * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha)) / r;
}
// Sonnenauf-/untergänge im 48-h-Fenster (Suche in 2-Minuten-Schritten)
function sunEvents(lat, lon, start) {
  const ev = []; let prev = sunAlt(lat, lon, start);
  for (let t = start + 120e3; t <= start + SPAN * H; t += 120e3) {
    const a = sunAlt(lat, lon, t);
    if (prev < -0.833 && a >= -0.833) ev.push({ t, type: 'SR' });
    if (prev >= -0.833 && a < -0.833) ev.push({ t, type: 'SS' });
    prev = a;
  }
  return ev;
}

// ---------- Netz ----------
async function getJSON(url) {
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text(); return txt.trim() ? JSON.parse(txt) : [];
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message.startsWith('HTTP') ? e.message : 'nicht erreichbar');
  } finally { clearTimeout(tm); }
}
// Wetter- und Platzdaten von der eigenen Adresse (keine Browser-Sperre)
async function loadData() {
  const [metar, taf, airports, status] = await Promise.all(['metar', 'taf', 'airports', 'status'].map((n) => getJSON(`${DATA}${n}.json`).catch(() => null)));
  return { metar: metar || [], taf: taf || [], airports: airports || {}, status };
}
// ---------- Wetter auswerten ----------
// Sicht: aviationweather.gov liefert Meilen, "6+" bedeutet 10 km oder mehr
function parseVis(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.includes('+')) return 10;
  const n = parseFloat(v); if (isNaN(n)) return null;
  if (n > 50) return Math.min(10, n / 1000); // Meter
  return n >= 6 ? 10 : Math.round(n * 1.609 * 10) / 10;
}
// Hauptwolkenuntergrenze = tiefste Schicht BKN/OVC oder Vertikalsicht. Infinity = keine.
function ceilOf(clouds) {
  if (!Array.isArray(clouds)) return undefined;
  const c = clouds.filter((l) => /BKN|OVC|OVX|VV/.test(l.cover || '') && l.base != null).map((l) => +l.base);
  return c.length ? Math.min(...c) : Infinity;
}
const wx = (f) => ({ wdir: f.wdir, wspd: f.wspd, wgst: f.wgst });

// TAF zum Zeitpunkt t: vorherrschender Zustand + TEMPO/PROB (vorübergehend schlechter)
// TAF aus dem Original-Text lesen (unabhängig davon, wie die Quelle die Gruppen aufbereitet)
function parseRawTAF(taf) {
  const raw = taf?.rawTAF; if (!raw) return null;
  const ref = toMs(taf.validTimeFrom) || toMs(taf.issueTime) || Date.now();
  const R = new Date(ref);
  const at = (dd, hh, mm = 0) => {
    let t = Date.UTC(R.getUTCFullYear(), R.getUTCMonth(), +dd, +hh, +mm);
    if (t < ref - 15 * 864e5) t = Date.UTC(R.getUTCFullYear(), R.getUTCMonth() + 1, +dd, +hh, +mm);
    if (t > ref + 15 * 864e5) t = Date.UTC(R.getUTCFullYear(), R.getUTCMonth() - 1, +dd, +hh, +mm);
    return t;
  };
  const period = (s) => { const m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(s || ''); return m ? [at(m[1], m[2]), at(m[3], m[4])] : null; };
  const toks = raw.replace(/=/g, ' ').trim().split(/\s+/);
  let i = 0;
  while (i < toks.length && /^(TAF|AMD|COR|RTD)$/.test(toks[i])) i++;
  i++; // Kennung
  if (/^\d{6}Z$/.test(toks[i])) i++;
  const valid = period(toks[i]); if (!valid) return null; i++;
  const groups = []; let g = { fcstChange: null, timeFrom: valid[0], timeTo: valid[1], clouds: [], wx: [] };
  groups.push(g);
  const start = (ch, a, b, prob) => { g = { fcstChange: ch, timeFrom: a, timeTo: b, timeBec: ch === 'BECMG' ? b : null, probability: prob || null, clouds: [], wx: [] }; groups.push(g); };
  for (; i < toks.length; i++) {
    const t = toks[i]; let m;
    if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) { start('FM', at(m[1], m[2], m[3]), valid[1]); continue; }
    if (t === 'BECMG' || t === 'TEMPO') { const p = period(toks[i + 1]); if (p) { start(t, p[0], p[1]); i++; } continue; }
    if ((m = /^PROB(\d{2})$/.exec(t))) {
      let ch = 'PROB', k = i + 1; if (toks[k] === 'TEMPO') { ch = 'TEMPO'; k++; }
      const p = period(toks[k]); if (p) { start(ch, p[0], p[1], +m[1]); i = k; } continue;
    }
    if ((m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(t))) {
      const f = m[4] === 'MPS' ? 1.944 : 1;
      g.wdir = m[1] === 'VRB' ? 'VRB' : +m[1]; g.wspd = Math.round(+m[2] * f); g.wgst = m[3] ? Math.round(+m[3] * f) : null; continue;
    }
    if (t === 'CAVOK') { g.visib = '6+'; g.clouds = [{ cover: 'CAVOK', base: null }]; continue; }
    if (/^\d{4}$/.test(t) && !g.visib) { g.visib = t === '9999' ? '6+' : +t; continue; }
    if ((m = /^P?(\d+)SM$/.exec(t))) { g.visib = t.startsWith('P') ? '6+' : +m[1]; continue; }
    if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(t))) { g.clouds.push({ cover: m[1], base: +m[2] * 100, type: m[3] || null }); continue; }
    if ((m = /^VV(\d{3})$/.exec(t))) { g.clouds.push({ cover: 'VV', base: +m[1] * 100 }); continue; }
    if (/^(NSC|SKC|NCD|CLR)$/.test(t)) { g.clouds = [{ cover: t, base: null }]; continue; }
    if (t === 'NSW') { g.wx.push('NSW'); continue; }
    if (/^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*$/.test(t) && /[A-Z]{2}/.test(t)) { g.wx.push(t); continue; }
  }
  // Gruppen ohne Wolkenangabe: „keine Angabe" (nicht „keine Wolken")
  groups.forEach((x) => { x.wxString = x.wx.join(' '); delete x.wx; if (!x.clouds.length) x.clouds = undefined; });
  if (!groups[0].clouds) groups[0].clouds = [];
  // FM beendet die vorherige Grundgruppe
  for (let k = 1; k < groups.length; k++) if (groups[k].fcstChange === 'FM') {
    for (let j = k - 1; j >= 0; j--) if (!groups[j].fcstChange || groups[j].fcstChange === 'FM') { groups[j].timeTo = groups[k].timeFrom; break; }
  }
  return { ...taf, validTimeFrom: valid[0], validTimeTo: valid[1], fcsts: groups, parsed: true };
}
const tafCache = new WeakMap();
function tafModel(taf) {
  if (!taf) return null;
  if (!tafCache.has(taf)) { let p = null; try { p = parseRawTAF(taf); } catch { p = null; } tafCache.set(taf, p && p.fcsts.length ? p : taf); }
  return tafCache.get(taf);
}

function tafAt(taf, t) {
  if (!taf?.fcsts?.length) return null;
  const from = toMs(taf.validTimeFrom), to = toMs(taf.validTimeTo);
  if ((from && t < from) || (to && t >= to)) return null;
  const norm = (f) => ({ ceil: f.clouds?.length ? ceilOf(f.clouds) : Infinity, vis: parseVis(f.visib) ?? 10, ...wx(f), wx: f.wxString || '' });
  const merge = (b, f) => ({
    ceil: f.clouds?.length ? ceilOf(f.clouds) : b.ceil,
    vis: parseVis(f.visib) ?? b.vis,
    ...(f.wspd != null ? wx(f) : wx(b)),
    wx: f.wxString || b.wx,
  });
  let base = null; const temps = [];
  for (const f of taf.fcsts) {
    const ch = String(f.fcstChange || '').toUpperCase();
    const a = toMs(f.timeFrom) ?? from, b = toMs(f.timeTo) ?? to;
    if (ch === 'TEMPO' || ch.startsWith('PROB') || f.probability) { if (a <= t && t < b) temps.push(f); continue; }
    if (!base) { base = norm(f); continue; }
    if (a > t) continue;
    if (ch === 'BECMG') {
      const m = merge(base, f), end = toMs(f.timeBec) ?? a + 2 * H;
      // Übergangszeit: Verschlechterung gilt sofort, Verbesserung erst am Ende
      base = t < end ? { ...m, ceil: Math.min(base.ceil, m.ceil), vis: Math.min(base.vis, m.vis), wspd: Math.max(base.wspd ?? 0, m.wspd ?? 0), wgst: Math.max(base.wgst ?? 0, m.wgst ?? 0) || null } : m;
    } else base = norm(f);
  }
  if (!base) return null;
  let tempo = null;
  for (const f of temps) {
    const m = merge(base, f);
    tempo = tempo ? { ceil: Math.min(tempo.ceil, m.ceil), vis: Math.min(tempo.vis, m.vis), wgst: Math.max(tempo.wgst || 0, m.wgst || 0) || null, wx: tempo.wx || m.wx }
      : { ceil: m.ceil, vis: m.vis, wgst: m.wgst, wx: m.wx };
  }
  return { ...base, tempo };
}

// Modell: tiefste Druckfläche mit mind. 50 % Bewölkung, zwischen den Flächen interpoliert
function modelCeil(hr, i, elev) {
  let ph = 0, pc = 0;
  for (const L of LEVELS) {
    const gh = hr[`geopotential_height_${L}hPa`]?.[i], cc = hr[`cloud_cover_${L}hPa`]?.[i];
    if (gh == null || cc == null) continue;
    const h = gh - elev; if (h <= 0) continue;
    if (cc >= 50) { const f = cc === pc ? 0 : (50 - pc) / (cc - pc); return Math.max(0, (ph + f * (h - ph)) * FT); }
    ph = h; pc = cc;
  }
  return Infinity;
}

// Flugkategorie (international üblich, wie bei metar-taf.com)
function category(ceil, vis) {
  ceil = ceil ?? Infinity; vis = vis ?? 10;
  if (ceil < 500 || vis < 1.6) return 'LIFR';
  if (ceil < 1000 || vis < 4.8) return 'IFR';
  if (ceil <= 3000 || vis <= 8) return 'MVFR';
  return 'VFR';
}

// Alle 48 Stunden eines Platzes berechnen (neu bei jeder Anzeige, damit geänderte Minima sofort wirken)
function computeHours(ap, start, s) {
  const idx = new Map();
  ap.model?.time?.forEach((t, i) => idx.set(toMs(t), i));
  const out = [];
  for (let i = 0; i < SPAN; i++) {
    const t = start + i * H, tm = t + H / 2;
    const taf = ap.taf && ap.tafUse ? tafAt(tafModel(ap.taf), tm) : null;
    const mi = idx.get(t);
    const hr = ap.model;
    const mdl = mi == null ? null : {
      ceil: modelCeil(hr, mi, ap.modelElev || 0),
      vis: hr.visibility?.[mi] != null ? Math.min(10, hr.visibility[mi] / 1000) : null,
      wdir: hr.wind_direction_10m?.[mi], wspd: hr.wind_speed_10m?.[mi], wgst: hr.wind_gusts_10m?.[mi],
    };
    const best = taf || mdl;
    const w = taf?.wspd != null ? taf : mdl;
    const alt = sunAlt(ap.lat, ap.lon, tm);
    const h = { i, t, taf, mdl, src: taf ? 'TAF' : mdl ? 'Modell' : null, ceil: best?.ceil, vis: best?.vis, wind: w ? wx(w) : null, alt };
    h.cat = best ? category(h.ceil, h.vis) : null;
    const windBad = (w?.wspd ?? 0) > s.maxWind || (w?.wgst ?? 0) > s.maxGust;
    h.why = [(h.ceil ?? Infinity) < s.minCeil && 'Wolken', (h.vis ?? 10) < s.minVis && 'Sicht', windBad && 'Wind'].filter(Boolean);
    if (!best) h.status = 'none';
    else if (h.why.length) h.status = 'below';
    else if (taf?.tempo && ((taf.tempo.ceil ?? Infinity) < s.minCeil || (taf.tempo.vis ?? 10) < s.minVis || (taf.tempo.wgst ?? 0) > s.maxGust)) h.status = 'tempo';
    else h.status = 'ok';
    h.day = alt >= -6; // VFR-Tag: bis Ende der bürgerlichen Dämmerung
    out.push(h);
  }
  return out;
}

// ---------- Daten laden ----------
function parseIds(text) {
  return [...new Set(String(text).toUpperCase().split(/[^A-Z0-9]+/).filter((x) => /^[A-Z0-9]{4}$/.test(x)))].slice(0, 8);
}
const latest = (arr, id, key) => arr.filter((x) => x.icaoId === id).sort((a, b) => toMs(b[key]) - toMs(a[key]))[0];
function nearest(arr, lat, lon, exclude) {
  return arr.filter((x) => x.icaoId !== exclude && x.lat != null)
    .map((x) => ({ x, d: distKm(lat, lon, +x.lat, +x.lon) })).sort((a, b) => a.d - b.d)[0];
}

// Wetter- und Platzdaten nur alle paar Minuten neu holen (für die Anzeige beim Eintippen)
let WCACHE = null;
async function wdata(force) {
  if (force || !WCACHE || Date.now() - WCACHE.at > 5 * 6e4) WCACHE = { ...(await loadData()), at: Date.now() };
  return WCACHE;
}
// Woher kommt das Wetter für einen Platz? (für die Hinweise in Schritt 1)
function wxSource(W, id) {
  if (!/^[A-Z0-9]{4}$/.test(id)) return null;
  const c = store.get('coords', {})[id], a = W.airports[id];
  const pos = c || (a && { lat: a[1], lon: a[2] });
  if (!pos) return { bad: true, text: 'Nicht in der Datenbank – Koordinaten in den Einstellungen eintragen' };
  const name = c?.name || a?.[0] || '';
  const ownM = W.metar.some((x) => x.icaoId === id), ownT = W.taf.some((x) => x.icaoId === id);
  let src;
  if (ownM && ownT) src = 'eigenes METAR und TAF';
  else if (ownT) src = 'eigener TAF';
  else {
    const n = nearest(W.taf, pos.lat, pos.lon, id);
    src = n && n.d <= 30 ? `TAF von ${n.x.icaoId} (${Math.round(n.d)} km)` : 'nur Modellvorhersage';
    if (ownM) src = 'eigenes METAR, ' + src;
  }
  return { name, text: src };
}

// Lädt METAR, TAF, Modell (und bei Routen das Streckenprofil) für eine Liste von Plätzen
async function fetchSet(ids, altId, withProfile) {
  const errors = [];
  const W = await wdata(true);
  if (!W.status) errors.push('METAR/TAF nicht erreichbar (offline?) – es wird nur das Modell genutzt.');
  else if (W.status.errors?.length) errors.push('Wetterquelle: ' + W.status.errors.join(' · '));
  const coords = store.get('coords', {});
  const alt = altId && !ids.includes(altId) ? altId : null;
  const list = alt ? [...ids, alt] : ids;

  const airports = await Promise.all(list.map(async (id, k) => {
    const isAlt = !!alt && k === ids.length;
    const m = W.metar.find((x) => x.icaoId === id), t = W.taf.find((x) => x.icaoId === id);
    const a = W.airports[id], c = coords[id];
    const src = c || (a && { lat: a[1], lon: a[2] }) || m || t;
    if (!src || src.lat == null) return { id, name: id, isAlt, error: 'Platz nicht in der Datenbank. Koordinaten in den Einstellungen eintragen.' };
    const ap = { id, isAlt, name: c?.name || a?.[0] || id, lat: +src.lat, lon: +src.lon, elevFt: a?.[3] ?? null, metar: m || null, taf: t || null, tafUse: !!t, notes: [] };
    // Kleiner Platz ohne eigenes Wetter: nächstgelegene Station
    if (!m) {
      const n = nearest(W.metar, ap.lat, ap.lon, id);
      if (n && n.d <= 60) { ap.metar = n.x; ap.metarSrc = { id: n.x.icaoId, dist: Math.round(n.d) }; }
    }
    if (!t) {
      const n = nearest(W.taf, ap.lat, ap.lon, id);
      if (n && n.d <= 80) { ap.taf = n.x; ap.tafSrc = { id: n.x.icaoId, dist: Math.round(n.d) }; ap.tafUse = n.d <= 30; }
    }
    if (!ap.metar && !ap.taf && W.status) ap.notes.push('Kein METAR/TAF in der Nähe – Grafik nutzt das Modell.');
    const vars = ['visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'cloud_cover_low',
      ...LEVELS.flatMap((L) => [`cloud_cover_${L}hPa`, `geopotential_height_${L}hPa`]),
      ...[925, 850, 700].flatMap((L) => [`wind_speed_${L}hPa`, `wind_direction_${L}hPa`])].join(',');
    try {
      const om = await getJSON(`${OM}?latitude=${ap.lat}&longitude=${ap.lon}&hourly=${vars}&wind_speed_unit=kn&timezone=UTC&forecast_days=3`);
      ap.model = om.hourly; ap.modelElev = om.elevation || 0;
    } catch (e) { ap.notes.push('Modellvorhersage nicht verfügbar (' + e.message + ').'); }
    return ap;
  }));

  const start = Math.floor(Date.now() / H) * H;
  const route = airports.filter((a) => !a.error && !a.isAlt);
  let profile = null;
  if (withProfile && route.length > 1) profile = await loadProfile(route, start).catch((e) => { errors.push('Streckenprofil: ' + e.message); return null; });
  return { fetchedAt: Date.now(), dataAt: W.status?.fetchedAt ? W.status.fetchedAt * 1000 : null, start, ids, altId: alt, airports, errors, demo: false, profile };
}

// Flug laden (Tab „Flug")
async function loadFlight(ids, altId) {
  loading = 'flug'; route();
  try { F = await fetchSet(ids, altId, true); store.set('briefing', F); } finally { loading = false; }
  sel = 0; route();
}
// Einzelnen Platz laden (Tab „Wetter")
async function loadWx(id) {
  loading = 'wx'; route();
  try {
    V = await fetchSet([id], null, false); store.set('wxView', V);
    const r = [id, ...store.get('recentWx', []).filter((x) => x !== id)].slice(0, 8); store.set('recentWx', r);
  } finally { loading = false; }
  sel = Math.max(0, Math.min(SPAN - 1, Math.floor((Date.now() - V.start) / H))); route();
}

// ---------- Grafik (SVG) ----------
// Gleiche aufeinanderfolgende Werte zu Abschnitten zusammenfassen: [{k, a, b}]
function runs(arr, key) {
  const r = [];
  arr.forEach((v, i) => { const k = key(v); const last = r[r.length - 1]; if (last && last.k === k) last.b = i + 1; else r.push({ k, a: i, b: i + 1 }); });
  return r;
}
const light = (lat, lon, t) => { const a = sunAlt(lat, lon, t); return a >= -0.833 ? 'day' : a >= -6 ? 'twi' : 'night'; };
const dayLabel = (t) => { const d = new Date(t); return `${WD[d.getUTCDay()]} ${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.`; };
const nowIndex = () => Math.max(0, Math.min(SPAN - 1, Math.floor((Date.now() - B.start) / H)));

function smooth(pts) { // weiche Linie durch die Punkte
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], mx = (x0 + x1) / 2;
    d += `C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function chartSVG(ap, hours, s, eta) {
  const W = 960, L = 48, R = 14, T = 28, PH = 190, pw = W - L - R;
  const yMax = Math.max(5000, Math.ceil((s.minCeil + 1500) / 1000) * 1000);
  const x = (i) => L + (i / SPAN) * pw;
  const y = (v) => T + PH - (Math.min(v, yMax) / yMax) * PH;
  const sY = T + PH + 10, wY = sY + 40, aY = wY + 40, Hh = aY + 8;
  const cw = pw / SPAN;
  let g = '';

  // Tag/Nacht in 10-Minuten-Schritten, zu Flächen zusammengefasst
  const steps = Array.from({ length: SPAN * 6 }, (_, k) => light(ap.lat, ap.lon, B.start + k * 6e5 + 3e5));
  runs(steps, (v) => v).filter((r) => r.k !== 'day').forEach((r) => {
    g += `<rect class="ch-${r.k}" x="${x(r.a / 6)}" y="${T}" width="${x(r.b / 6) - x(r.a / 6)}" height="${PH}"/>`;
  });
  // Waagerechtes Raster
  for (let v = 1000; v <= yMax; v += 1000) {
    g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  g += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><text class="ch-label" x="${L - 8}" y="${y(0) + 4}" text-anchor="end">ft</text>`;
  // Tageswechsel und Zeitachse
  for (let i = 0; i < SPAN; i++) {
    const t = B.start + i * H, hz = new Date(t).getUTCHours();
    if (hz === 0) g += `<line class="ch-day" x1="${x(i)}" x2="${x(i)}" y1="${T - 18}" y2="${T + PH}"/><text class="ch-label ch-strong" x="${x(i) + 6}" y="${T - 8}">${dayLabel(t)}</text>`;
    if (i % 3 === 0) g += `<text class="ch-label" x="${x(i)}" y="${aY}" text-anchor="middle">${p2(hz)}</text>`;
  }
  if (new Date(B.start).getUTCHours() > 2) g += `<text class="ch-label ch-strong" x="${L}" y="${T - 8}">${dayLabel(B.start)}</text>`;
  g += `<text class="ch-label" x="${W - R}" y="${aY}" text-anchor="end">UTC</text>`;

  // Modell: weiche Fläche
  const mp = hours.filter((h) => h.mdl).map((h) => [x(h.i + 0.5), y(h.mdl.ceil)]);
  if (mp.length) {
    const line = smooth(mp);
    g += `<path class="ch-model-area" d="${line}L${mp[mp.length - 1][0]},${y(0)}L${mp[0][0]},${y(0)}Z"/><path class="ch-model" d="${line}"/>`;
  }
  // TAF als Stufenlinie, TEMPO gestrichelt
  const step = (get, cls) => {
    let d = '', prev = null;
    hours.forEach((h) => {
      const v = get(h);
      if (v == null) { prev = null; return; }
      const yy = y(v).toFixed(1);
      d += prev == null ? `M${x(h.i)},${yy}` : `V${yy}`;
      d += `H${x(h.i + 1)}`; prev = v;
    });
    return d ? `<path class="${cls}" d="${d}"/>` : '';
  };
  g += step((h) => { const c = h.taf?.tempo?.ceil; return c != null && isFinite(c) && c < (h.taf.ceil ?? Infinity) ? c : null; }, 'ch-tempo');
  g += step((h) => h.taf?.ceil, 'ch-taf');
  // Minimum mit Beschriftung als Kapsel
  const my = y(s.minCeil), lw = 118;
  g += `<line class="ch-min" x1="${L}" x2="${W - R}" y1="${my}" y2="${my}"/>
    <rect class="ch-minpill" x="${W - R - lw}" y="${my - 11}" width="${lw}" height="22" rx="11"/>
    <text class="ch-minlabel" x="${W - R - lw / 2}" y="${my + 4.5}" text-anchor="middle">Min. ${s.minCeil} ft</text>`;
  // Jetzt
  const nowI = (Date.now() - B.start) / H;
  if (nowI >= 0 && nowI <= SPAN) {
    g += `<line class="ch-now" x1="${x(nowI)}" x2="${x(nowI)}" y1="${T}" y2="${y(0)}"/>`;
  }
  if (eta && eta.t >= B.start && eta.t <= B.start + SPAN * H) {
    const ex = x((eta.t - B.start) / H), lab = eta.kind === 'Abflug' ? 'ETD' : 'ETA';
    g += `<line class="ch-eta" x1="${ex}" x2="${ex}" y1="${T}" y2="${y(0)}"/><rect class="ch-etapill" x="${ex - 22}" y="${T + 4}" width="44" height="20" rx="10"/><text class="ch-etalabel" x="${ex}" y="${T + 18}" text-anchor="middle">${lab}</text>`;
  }
  const mc = ceilOf(ap.metar?.clouds), mt = toMs(ap.metar?.obsTime);
  if (mc !== undefined && mt && mt > B.start - 2 * H) g += `<circle class="ch-metar" cx="${Math.max(L, x((mt - B.start) / H))}" cy="${y(mc)}" r="7"/>`;

  // Kategorie als durchgehende Bänder, darunter Markierung „unter Minima"
  runs(hours, (h) => h.cat || 'none').forEach((r) => {
    g += `<rect class="cat-${r.k}" x="${x(r.a) + 1}" y="${sY}" width="${x(r.b) - x(r.a) - 2}" height="10" rx="5"/>`;
  });
  runs(hours, (h) => h.status).filter((r) => r.k === 'below' || r.k === 'tempo').forEach((r) => {
    g += `<rect class="mark-${r.k}" x="${x(r.a) + 1}" y="${sY + 15}" width="${x(r.b) - x(r.a) - 2}" height="4" rx="2"/>`;
  });
  // Wind alle 3 Stunden: Pfeil (wohin der Wind weht) und Stärke
  hours.filter((h) => h.i % 3 === 1 && h.wind?.wspd != null).forEach((h) => {
    const w = h.wind, cx = x(h.i + 0.5), bad = w.wspd > s.maxWind || (w.wgst || 0) > s.maxGust;
    if (typeof w.wdir === 'number' && w.wspd >= 1) g += `<g transform="translate(${cx},${wY - 6}) rotate(${w.wdir})"><path class="ch-arrow${bad ? ' bad' : ''}" d="M0,-7L0,7M-4.5,2.5L0,7L4.5,2.5"/></g>`;
    g += `<text class="ch-wind${bad ? ' bad' : ''}" x="${cx}" y="${wY + 16}" text-anchor="middle">${Math.round(w.wspd)}${w.wgst && w.wgst > w.wspd + 4 ? '<tspan class="g">G' + Math.round(w.wgst) + '</tspan>' : ''}</text>`;
  });
  g += `<text class="ch-label" x="${L - 8}" y="${wY + 16}" text-anchor="end">kt</text>`;
  // Auswahl
  g += `<rect class="ch-sel" data-sel x="${x(sel)}" y="${T}" width="${cw}" height="${sY + 20 - T}" rx="4"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" data-l="${L}" data-pw="${pw}" data-w="${W}" role="img" aria-label="Wolkenuntergrenze ${esc(ap.id)} über 48 Stunden">${g}</svg>`;
}

// Zeitleiste der Route: eine Zeile pro Platz, Farbbänder je Kategorie
function timelineHTML(all, fp) {
  const cells = (hours, cls, label, ei) => `<div class="tl-row">${runs(hours, (h) => cls(h)).map((r) =>
    hours.slice(r.a, r.b).map((h, k) => `<button class="tl-c ${cls(h)}${k === 0 ? ' rs' : ''}${k === r.b - r.a - 1 ? ' re' : ''}${h.i === ei ? ' eta' : ''} st-${h.status || 'x'}" data-i="${h.i}" aria-label="${esc(label)} ${utc(h.t)}"></button>`).join('')).join('')}</div>`;
  let head = '<div class="tl-name"></div><div class="tl-row tl-head">';
  for (let i = 0; i < SPAN; i++) {
    const t = B.start + i * H, hz = new Date(t).getUTCHours();
    head += `<span>${hz === 0 ? `<b>${WD[new Date(t).getUTCDay()]}</b>` : i % 6 === 0 && hz < 22 ? p2(hz) : ''}</span>`;
  }
  head += '</div>';
  const ref = all[0].ap;
  const lightRow = Array.from({ length: SPAN }, (_, i) => ({ i, t: B.start + i * H, l: light(ref.lat, ref.lon, B.start + i * H + H / 2) }));
  const lr = `<div class="tl-name tl-sub">Licht</div><div class="tl-row tl-light">${runs(lightRow, (h) => h.l).map((r) =>
    `<span class="l-${r.k}" style="flex:${r.b - r.a}"></span>`).join('')}</div>`;
  return `<div class="timeline">${head}${lr}${all.map(({ ap, hours }) =>
    `<div class="tl-name">${esc(ap.id)}</div>${cells(hours, (h) => 'cat-' + (h.cat || 'none'), ap.id, fp?.eta[ap.id] ? hourOf(fp.eta[ap.id].t) : null)}`).join('')}</div>`;
}

// Zeitfenster, in denen alle Plätze über den Minima liegen und Tag ist
function windows(all) {
  const res = []; let a = null;
  for (let i = 0; i <= SPAN; i++) {
    const ok = i < SPAN && all.every(({ hours }) => hours[i].status === 'ok' && hours[i].day);
    if (ok && a == null) a = i;
    if (!ok && a != null) { res.push([a, i]); a = null; }
  }
  return res;
}

function metarLine(m) {
  if (!m) return '';
  const c = (m.clouds || []).map((l) => l.base != null ? `${l.cover} ${l.base} ft` : l.cover).join(', ') || '–';
  return `Wind ${fmtWind(m)} · Sicht ${fmtVis(parseVis(m.visib))} · Wolken ${esc(c)} · ${m.temp ?? '–'}/${m.dewp ?? '–'} °C${m.altim ? ' · QNH ' + Math.round(m.altim) : ''}`;
}

const SYM = {
  ok: icon('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>'),
  warn: icon('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
  sunrise: icon('<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v3M12 4l-2 2M12 4l2 2M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4"/>'),
  sunset: icon('<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 7V4M12 7l-2-2M12 7l2-2M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/>'),
  reload: icon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  bookmark: icon('<path d="M6 3.5h12v17l-6-4-6 4z"/>'),
  share: icon('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H5.5v10.5h13V10H17"/>'),
};

// „Jetzt"-Kacheln: aktueller Zustand und nächste Änderung je Platz
function tilesHTML(all, fp) {
  const ni = nowIndex();
  return `<div class="tiles">${all.map(({ ap, hours }) => {
    if (!hours) return `<div class="tile"><div class="t-top"><span class="t-id">${esc(ap.id)}</span></div><p class="warn">${esc(ap.error)}</p></div>`;
    const h0 = hours[ni];
    const near = ap.metarSrc && ap.metarSrc.dist <= 30;
    const m = ap.metar && (!ap.metarSrc || near) && toMs(ap.metar.obsTime) > Date.now() - 2 * H ? ap.metar : null;
    const ceil = m ? ceilOf(m.clouds) : h0.ceil, vis = m ? parseVis(m.visib) : h0.vis;
    const cat = m || h0.cat ? category(ceil, vis) : null, src = m ? (ap.metarSrc ? `METAR ${ap.metarSrc.id} ${hhmm(toMs(m.obsTime))}Z (${ap.metarSrc.dist} km)` : `METAR ${hhmm(toMs(m.obsTime))}Z`) : h0.src || 'keine Daten';
    const good = h0.status === 'ok';
    const nx = hours.find((h) => h.i > ni && (h.status === 'ok') !== good && hours[h.i + 1] && (hours[h.i + 1].status === 'ok') !== good);
    const when = nx ? `${WD[new Date(nx.t).getUTCDay()]} ${p2(new Date(nx.t).getUTCHours())}Z` : '';
    const why = !good && h0.why?.length ? ` (${h0.why.join(', ')})` : !good && h0.status === 'tempo' ? ' (TEMPO)' : '';
    const nd = hours.find((h) => h.i > ni && h.status !== 'none');
    const trend = h0.status === 'none' ? (nd ? `Vorhersage ab ${WD[new Date(nd.t).getUTCDay()]} ${p2(new Date(nd.t).getUTCHours())}Z` : 'Keine Vorhersage')
      : good ? (nx ? `Über Minima bis ${when}` : 'Über Minima für 48 h') : (nx ? `Unter Minima${why} bis ${when}` : `Unter Minima${why} für 48 h`);
    const big = ceil == null ? '–' : ceil === Infinity ? 'frei' : Math.round(ceil / 100) * 100;
    return `<button class="tile" data-go="${esc(ap.id)}">
      <div class="t-top"><span class="t-id">${esc(ap.id)}</span>${cat ? `<span class="pill cat-${cat}">${cat}</span>` : ''}</div>
      <div class="t-name">${ap.isAlt ? '<b>Ausweichplatz</b> · ' : ''}${esc(ap.name)}</div>
      <div class="t-big">${big}${typeof big === 'number' ? '<small> ft</small>' : ''}</div>
      <div class="t-sub">Ceiling jetzt · ${src}</div>
      <div class="t-meta">${fmtWind(m || h0.wind)} · ${fmtVis(vis)}</div>
      <div class="t-trend ${h0.status === 'none' ? 'none' : good ? 'ok' : 'bad'}"><i></i>${trend}</div>
      ${(() => { const e = fp?.eta[ap.id]; if (!e) return ''; const i = hourOf(e.t); const h = i == null ? null : hours[i];
        const st = !h ? 'außerhalb 48 h' : h.status === 'none' ? 'keine Daten' : h.status === 'ok' ? (h.day ? 'über Minima' : 'Nacht') : h.status === 'tempo' ? 'TEMPO unter Minima' : 'unter Minima';
        return `<div class="t-eta ${h && h.status === 'ok' && h.day ? 'ok' : 'bad'}">${e.kind} ${hhmm(e.t)}Z · ${st}${h?.src ? ` (${h.src})` : ''}</div>`; })()}
    </button>`;
  }).join('')}</div>`;
}

function detailHTML(all) {
  const t = B.start + sel * H;
  return `<div class="sel-head"><span class="sel-time">${utc(t).slice(0, -4)}–${hhmm(t + H)} UTC</span><span class="sel-local">${local(t)} Ortszeit</span></div>
  <div class="tbl-wrap"><table class="tbl">
  <thead><tr><th>Platz</th><th>Kategorie</th><th>Ceiling</th><th>TEMPO</th><th>Sicht</th><th>Wind</th><th>Licht</th></tr></thead>
  <tbody>${all.map(({ ap, hours }) => {
    const h = hours[sel];
    return `<tr class="st-${h.status}"><td><span class="dot"></span><b>${esc(ap.id)}</b></td><td><span class="pill cat-${h.cat || 'none'}">${h.cat || '–'}</span></td>
    <td>${fmtCeil(h.ceil)} <span class="detail">${h.src || ''}</span></td>
    <td>${h.taf?.tempo ? fmtCeil(h.taf.tempo.ceil) + ' · ' + fmtVis(h.taf.tempo.vis) : '–'}</td>
    <td>${fmtVis(h.vis)}</td><td>${fmtWind(h.wind)}</td><td>${h.alt >= -0.833 ? 'Tag' : h.day ? 'Dämmerung' : 'Nacht'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function airportCard(ap, hours, s, fp) {
  if (ap.error) return `<section class="card ap" id="ap-${esc(ap.id)}"><div class="ap-head"><h3>${esc(ap.id)}</h3></div><p class="warn">${esc(ap.error)}</p></section>`;
  const ev = sunEvents(ap.lat, ap.lon, B.start);
  const src = ap.tafSrc ? (ap.tafUse ? `TAF ${ap.tafSrc.id} (${ap.tafSrc.dist} km)` : `Modell – TAF ${ap.tafSrc.id} zu weit (${ap.tafSrc.dist} km)`) : ap.taf ? 'TAF' : 'Modell – kein TAF';
  const below = hours.filter((h) => h.status === 'below').length;
  return `<section class="card ap" id="ap-${esc(ap.id)}">
    <div class="ap-head">
      <div><h3>${esc(ap.id)}</h3><div class="ap-name">${ap.isAlt ? 'Ausweichplatz · ' : ''}${esc(ap.name)}</div></div>
      ${hours.every((h) => h.status === 'none') ? '<span class="status none">keine Daten</span>' : `<span class="status ${below ? 'bad' : 'ok'}">${below ? `${below} h unter Minima` : 'Über Minima'}</span>`}
    </div>
    ${chartSVG(ap, hours, s, fp?.eta[ap.id])}
    <div class="legend">
      <span><i class="lg-taf"></i>${esc(src)}</span><span><i class="lg-tempo"></i>TEMPO/PROB</span>
      <span><i class="lg-model"></i>Modell (Schätzung)</span><span><i class="lg-metar"></i>METAR</span>
      <span><i class="lg-night"></i>Nacht</span>
    </div>
    <div class="sun">${ev.map((e) => `<span>${e.type === 'SR' ? SYM.sunrise + 'Aufgang' : SYM.sunset + 'Untergang'} ${WD[new Date(e.t).getUTCDay()]} ${hhmm(e.t)}Z</span>`).join('') || '–'}</div>
    <div class="raw">
      <div class="raw-box"><div class="raw-label">METAR${ap.metarSrc ? ` · ${esc(ap.metarSrc.id)}, ${ap.metarSrc.dist} km entfernt` : ''}</div>
        ${ap.metar ? `<code>${esc(ap.metar.rawOb)}</code><small>${metarLine(ap.metar)}</small>` : '<span class="detail">nicht verfügbar</span>'}</div>
      <div class="raw-box"><div class="raw-label">TAF${ap.tafSrc ? ` · ${esc(ap.tafSrc.id)}, ${ap.tafSrc.dist} km entfernt` : ''}</div>
        ${ap.taf ? `<code>${esc(ap.taf.rawTAF).replace(/ (?=(TEMPO|BECMG|FM\d|PROB\d))/g, '<br>&nbsp;&nbsp;')}</code>` : '<span class="detail">nicht verfügbar</span>'}</div>
    </div>
    ${ap.notes.map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
  </section>`;
}

// ---------- Flugplanung: Zeit, Wind, Kraftstoff ----------
const RAD = Math.PI / 180;
function course(a, b, c, d) { // rechtweisender Kurs von (a,b) nach (c,d)
  const y = Math.sin((d - b) * RAD) * Math.cos(c * RAD);
  const x = Math.cos(a * RAD) * Math.sin(c * RAD) - Math.sin(a * RAD) * Math.cos(c * RAD) * Math.cos((d - b) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function modelIdx(hr, t) {
  if (!hr?.time?.length) return null;
  const i = Math.round((Math.floor(t / H) * H - toMs(hr.time[0])) / H);
  return i >= 0 && i < hr.time.length ? i : null;
}
// Wind in Reiseflughöhe: Druckfläche, deren Höhe am nächsten liegt
function windAt(ap, t, altFt) {
  const hr = ap.model, i = modelIdx(hr, t); if (i == null) return null;
  let best = null;
  for (const L of [925, 850, 700]) {
    const gh = hr[`geopotential_height_${L}hPa`]?.[i], ws = hr[`wind_speed_${L}hPa`]?.[i], wd = hr[`wind_direction_${L}hPa`]?.[i];
    if (gh == null || ws == null || wd == null) continue;
    const d = Math.abs(gh * FT - altFt);
    if (!best || d < best.d) best = { d, ws, wd };
  }
  return best;
}
const depMs = (p) => {
  if (!p.depTime) return Math.ceil(Date.now() / H) * H;
  const n = new Date(), [hh, mm] = p.depTime.split(':').map(Number);
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + (+p.depDay || 0), hh || 0, mm || 0);
};
const fmtDur = (min) => `${Math.floor(min / 60)}:${p2(Math.round(min % 60))} h`;

function makeLeg(a, b, t, p) {
  const dist = distKm(a.lat, a.lon, b.lat, b.lon) / 1.852, tc = course(a.lat, a.lon, b.lat, b.lon);
  let wind = null, hw = 0, xw = 0;
  if (p.useWind) {
    const ws = [windAt(a, t, p.alt), windAt(b, t, p.alt)].filter(Boolean);
    if (ws.length) {
      let u = 0, v = 0; ws.forEach((w) => { u += w.ws * Math.sin(w.wd * RAD); v += w.ws * Math.cos(w.wd * RAD); });
      u /= ws.length; v /= ws.length;
      wind = { wd: (Math.atan2(u, v) / RAD + 360) % 360, ws: Math.hypot(u, v) };
      hw = wind.ws * Math.cos((wind.wd - tc) * RAD); xw = wind.ws * Math.sin((wind.wd - tc) * RAD);
    }
  }
  const wca = Math.asin(Math.max(-1, Math.min(1, xw / p.tas)));
  const gs = Math.max(30, p.tas * Math.cos(wca) - hw);
  const min = (dist / gs) * 60 + p.allow;
  return { from: a.id, to: b.id, dist, tc, var: 1.6 + 0.25 * ((a.lon + b.lon) / 2), wind, hw, gs, wca: wca / RAD, min, fuel: (min / 60) * p.burn, dep: t, arr: t + min * 6e4 };
}

function flightPlan(dep, p) {
  const aps = (B?.airports || []).filter((a) => !a.error && !a.isAlt);
  const altAp = (B?.airports || []).find((a) => a.isAlt && !a.error);
  const legs = []; let t = dep;
  for (let k = 0; k < aps.length - 1; k++) {
    const l = makeLeg(aps[k], aps[k + 1], t, p);
    legs.push(l);
    t = l.arr + (k < aps.length - 2 ? p.stop * 6e4 : 0);
  }
  const eta = {}; if (aps[0]) eta[aps[0].id] = { t: dep, kind: 'Abflug' };
  legs.forEach((l, k) => { eta[l.to] = { t: l.arr, kind: k < legs.length - 1 ? (p.stop > 0 ? 'Zwischenlandung' : 'Überflug') : 'Ankunft' }; });
  const end = legs.length ? legs[legs.length - 1].arr : dep;
  // Ausweichplatz: ab dem Ziel weiterfliegen (Kraftstoff nur zur Information)
  let altLeg = null;
  if (altAp && aps.length) { altLeg = makeLeg(aps[aps.length - 1], altAp, end, p); eta[altAp.id] = { t: altLeg.arr, kind: 'Ausweich' }; }
  const flight = legs.reduce((s, l) => s + l.min, 0), trip = legs.reduce((s, l) => s + l.fuel, 0);
  const reserve = (p.reserve / 60) * p.burn, taxi = p.taxi * (p.stop > 0 ? Math.max(1, legs.length) : 1);
  return { dep, legs, altLeg, eta, flight, dist: legs.reduce((s, l) => s + l.dist, 0), trip, reserve, taxi, total: trip + reserve + taxi, end };
}
const hourOf = (t) => { const i = Math.floor((t - B.start) / H); return i >= 0 && i < SPAN ? i : null; };

// Zeitpunkt, an dem man eine Stelle der Strecke (in NM) erreicht
function timeAtDist(fp, d) {
  let d0 = 0;
  for (const l of fp.legs) { if (d <= d0 + l.dist + 1e-6) return l.dep + ((d - d0) / l.dist) * (l.min - (fp.legs.length ? 0 : 0)) * 6e4; d0 += l.dist; }
  return fp.end;
}
// Streckenprofil auswerten: tiefste Lücke zwischen Wolkenbasis und Gelände
function profileCheck(fp, s) {
  const P = B.profile; if (!P || !fp.legs.length) return null;
  let worst = null;
  P.pts.forEach((pt) => {
    const t = timeAtDist(fp, pt.d), h = hourOf(t);
    const cb = h == null ? undefined : pt.c[h];
    const terr = terrainAt(pt.d);
    if (cb == null) return;
    const gap = cb - terr;
    if (!worst || gap < worst.gap) worst = { gap, d: pt.d, t, cb, terr };
  });
  return worst ? { ...worst, bad: worst.gap < s.minCeil, inCloud: worst.cb < s.alt + 500 } : { gap: Infinity, bad: false };
}
function terrainAt(d) {
  const T = B.profile.terrain; let best = 0;
  for (const p of T) if (Math.abs(p.d - d) <= B.profile.D / 60) best = Math.max(best, p.e);
  return best;
}

// Abflugzeiten in den nächsten 48 h, bei denen alles passt
function depWindows(all, p, s) {
  const res = []; let a = null;
  const byId = Object.fromEntries(all.map((x) => [x.ap.id, x.hours]));
  const apById = Object.fromEntries(all.map((x) => [x.ap.id, x.ap]));
  const mm = p.depTime ? +p.depTime.split(':')[1] || 0 : 0;
  for (let d = 0; d <= SPAN; d++) {
    let ok = false;
    const dep = B.start + d * H + mm * 6e4;
    if (d < SPAN && dep >= Date.now() - H) {
      const fp = flightPlan(dep, p);
      ok = Object.entries(fp.eta).filter(([, e]) => e.kind !== 'Ausweich').every(([id, e]) => { const i = hourOf(e.t), hs = byId[id]; return i != null && hs && hs[i].status === 'ok' && hs[i].day && (typeof isOpen !== 'function' || isOpen(apById[id], e.t) !== false); });
      if (ok && B.profile) { const pc = profileCheck(fp, { ...s, alt: p.alt }); ok = !pc?.bad; }
    }
    if (ok && a == null) a = dep;
    if (!ok && a != null) { res.push([a, dep - H]); a = null; }
  }
  return res;
}

// ---------- Streckenprofil laden (Gelände + Wolkenbasis entlang der Linie) ----------
async function loadProfile(aps, start) {
  const segs = [], marks = [{ id: aps[0].id, d: 0 }]; let D = 0;
  for (let k = 0; k < aps.length - 1; k++) {
    const len = distKm(aps[k].lat, aps[k].lon, aps[k + 1].lat, aps[k + 1].lon) / 1.852;
    segs.push({ a: aps[k], b: aps[k + 1], d0: D, len }); D += len; marks.push({ id: aps[k + 1].id, d: D });
  }
  if (D < 2) return null;
  const at = (d) => { const sg = segs.find((x) => d <= x.d0 + x.len + 1e-6) || segs[segs.length - 1]; const f = sg.len ? (d - sg.d0) / sg.len : 0; return [sg.a.lat + (sg.b.lat - sg.a.lat) * f, sg.a.lon + (sg.b.lon - sg.a.lon) * f]; };
  const ll = (ds) => { const c = ds.map(at); return `latitude=${c.map((x) => x[0].toFixed(4)).join(',')}&longitude=${c.map((x) => x[1].toFixed(4)).join(',')}`; };
  const n = Math.min(50, Math.max(3, Math.round(D / 6) + 1)), pd = Array.from({ length: n }, (_, i) => (D * i) / (n - 1));
  const m = Math.min(300, Math.max(40, Math.round(D * 2))), td = Array.from({ length: m }, (_, i) => (D * i) / (m - 1));
  const chunks = []; for (let i = 0; i < td.length; i += 100) chunks.push(td.slice(i, i + 100));
  const vars = LEVELS.flatMap((L) => [`cloud_cover_${L}hPa`, `geopotential_height_${L}hPa`]).join(',');
  const [fc, ...el] = await Promise.all([
    getJSON(`${OM}?${ll(pd)}&hourly=${vars}&timezone=UTC&forecast_days=3`),
    ...chunks.map((ch) => getJSON(`https://api.open-meteo.com/v1/elevation?${ll(ch)}`)),
  ]);
  const arr = Array.isArray(fc) ? fc : [fc];
  const elev = el.flatMap((x) => x.elevation || []);
  return {
    D, marks,
    terrain: td.map((d, i) => ({ d, e: Math.round((elev[i] || 0) * FT) })),
    pts: arr.map((o, i) => ({ d: pd[i], c: Array.from({ length: SPAN }, (_, h) => {
      const k = modelIdx(o.hourly, start + h * H); if (k == null) return null;
      const c = modelCeil(o.hourly, k, o.elevation || 0); return c === Infinity ? null : Math.round(c + (o.elevation || 0) * FT);
    }) })),
  };
}

function profileSVG(fp, s, p) {
  const P = B.profile, W = 960, L = 54, R = 14, T = 16, PH = 220, pw = W - L - R;
  const maxT = Math.max(...P.terrain.map((x) => x.e));
  const yMax = Math.max(6000, Math.ceil((Math.max(maxT + 3000, p.alt + 2000)) / 1000) * 1000);
  const x = (d) => L + (d / P.D) * pw, y = (v) => T + PH - (Math.min(Math.max(v, 0), yMax) / yMax) * PH;
  let g = '';
  for (let v = 1000; v <= yMax; v += yMax > 8000 ? 2000 : 1000) g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  g += `<text class="ch-label" x="${L - 8}" y="${y(0) + 4}" text-anchor="end">MSL</text>`;
  // Wolken: Fläche von der Basis nach oben
  const cp = P.pts.map((pt) => { const h = hourOf(timeAtDist(fp, pt.d)); const cb = h == null ? null : pt.c[h]; return { d: pt.d, cb, h }; });
  const top = cp.map((q) => [x(q.d), y(q.cb ?? yMax)]);
  g += `<path class="pr-cloud" d="${smooth(top)}L${x(P.D)},${T}L${x(0)},${T}Z"/>`;
  // Gelände
  g += `<path class="pr-terrain" d="M${x(0)},${y(0)}${P.terrain.map((q) => `L${x(q.d).toFixed(1)},${y(q.e).toFixed(1)}`).join('')}L${x(P.D)},${y(0)}Z"/>`;
  // Wolkenbasis: rot, wo der Abstand zum Gelände unter dem Minimum liegt
  for (let k = 1; k < cp.length; k++) {
    const a = cp[k - 1], b = cp[k]; if (a.cb == null || b.cb == null) continue;
    const bad = Math.min(a.cb - terrainAt(a.d), b.cb - terrainAt(b.d)) < s.minCeil;
    g += `<path class="pr-base${bad ? ' bad' : ''}" d="${smooth([[x(a.d), y(a.cb)], [x(b.d), y(b.cb)]])}"/>`;
  }
  // Reiseflughöhe
  g += `<line class="pr-alt" x1="${L}" x2="${W - R}" y1="${y(p.alt)}" y2="${y(p.alt)}"/><text class="pr-altlabel" x="${L + 8}" y="${y(p.alt) - 7}">Reiseflughöhe ${p.alt} ft</text>`;
  // Plätze
  P.marks.forEach((mk, k) => {
    const e = fp.eta[mk.id], anchor = k === 0 ? 'start' : k === P.marks.length - 1 ? 'end' : 'middle';
    g += `<line class="ch-day" x1="${x(mk.d)}" x2="${x(mk.d)}" y1="${T}" y2="${y(0)}"/>
      <text class="ch-label ch-strong" x="${x(mk.d)}" y="${y(0) + 20}" text-anchor="${anchor}">${esc(mk.id)}</text>
      <text class="ch-label" x="${x(mk.d)}" y="${y(0) + 37}" text-anchor="${anchor}">${e ? hhmm(e.t) + 'Z' : ''} · ${Math.round(mk.d)} NM</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${y(0) + 44}" role="img" aria-label="Streckenprofil mit Gelände und Wolkenbasis">${g}</svg>`;
}

// ---------- Flugzeuge (Richtwerte, ca. 65–75 % Leistung) ----------
function planDetailsHTML(fp, p) {
  if (!fp.legs.length) return '<p class="group-note">Für Etappen mindestens zwei Plätze im Briefing laden.</p>';
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Etappe</th><th>Distanz</th><th>rwK / mwK</th><th>Wind</th><th>GS</th><th>Zeit</th><th>Abflug → Ankunft</th><th>Kraftstoff</th></tr></thead>
    <tbody>${fp.legs.map((l) => `<tr><td><b>${esc(l.from)} → ${esc(l.to)}</b></td><td>${Math.round(l.dist)} NM</td><td>${p2(Math.round(l.tc)).padStart(3, '0')}° / ${p2(Math.round((l.tc - l.var + 360) % 360)).padStart(3, '0')}°</td>
      <td>${l.wind ? `${p2(Math.round(l.wind.wd / 10) * 10).padStart(3, '0')}°/${Math.round(l.wind.ws)} kt <span class="detail">${l.hw >= 0 ? 'Gegen' : 'Rücken'} ${Math.abs(Math.round(l.hw))}</span>` : '–'}</td>
      <td>${Math.round(l.gs)} kt</td><td>${fmtDur(l.min)}</td><td>${hhmm(l.dep)}Z → ${hhmm(l.arr)}Z</td><td>${Math.round(l.fuel)} l</td></tr>`).join('')}
    </tbody></table></div>
    <div class="sums">
      <div><span>Flugzeit</span><b>${fmtDur(fp.flight)}</b></div>
      <div><span>Distanz</span><b>${Math.round(fp.dist)} NM</b></div>
      <div><span>Ankunft</span><b>${hhmm(fp.end)}Z</b></div>
      <div><span>Kraftstoff gesamt</span><b>${Math.ceil(fp.total)} l</b><small>Flug ${Math.round(fp.trip)} · Reserve ${Math.round(fp.reserve)} · Rollen ${Math.round(fp.taxi)}</small></div>
    </div>`;
}

const CHECKS = [
  ['wx', 'Wetter geprüft: dieses Briefing und amtlich beim DWD (flugwetter.de)'],
  ['notam', 'NOTAM und Luftraum geprüft (DFS AIS: Sperrgebiete, ED-R, TRA)'],
  ['aip', 'Platzinfos: Öffnungszeiten, PPR, Frequenzen, Pisten (AIP VFR)'],
  ['fuel', 'Kraftstoff an Bord ≥ Bedarf inkl. Reserve'],
  ['mass', 'Masse und Schwerpunkt berechnet'],
  ['perf', 'Start- und Landestrecke geprüft (Temperatur, Höhe, Piste)'],
  ['alt', 'Ausweichplatz festgelegt'],
  ['fpl', 'Flugplan aufgegeben, falls nötig (z. B. Grenzüberflug)'],
  ['docs', 'Dokumente: Lizenz, Medical, Bordbuch, Versicherung'],
  ['me', 'Persönlich fit (Schlaf, Gesundheit, kein Zeitdruck)'],
];
const checks = () => store.get('checks', {});

// ---------- Wetter in Worten ----------
const COV = { FEW: 'wenige', SCT: 'aufgelockert', BKN: 'durchbrochen', OVC: 'bedeckt', OVX: 'Vertikalsicht', VV: 'Vertikalsicht', NSC: 'keine signifikanten Wolken', SKC: 'wolkenlos', CLR: 'wolkenlos', NCD: 'keine Wolken', CAVOK: 'CAVOK' };
const WXW = { BR: 'Dunst', FG: 'Nebel', RA: 'Regen', DZ: 'Niesel', SN: 'Schnee', SH: 'Schauer', TS: 'Gewitter', GR: 'Hagel', GS: 'Graupel', FZ: 'gefrierend', MI: 'flach', BC: 'Schwaden', PR: 'teilweise', HZ: 'trockener Dunst', VC: 'in der Nähe', BL: 'Treiben', DR: 'Fegen', PL: 'Eiskörner', SG: 'Schneegriesel', FU: 'Rauch', SQ: 'Böenwalze', UP: 'unbekannter Niederschlag' };
function wxWords(s) {
  return String(s || '').split(/\s+/).filter(Boolean).map((tok) => {
    let pre = '';
    if (tok[0] === '-') { pre = 'leicht: '; tok = tok.slice(1); } else if (tok[0] === '+') { pre = 'stark: '; tok = tok.slice(1); }
    if (tok === 'NSW') return 'kein signifikantes Wetter';
    return pre + (tok.match(/.{2}/g) || []).map((x) => WXW[x] || x).join(' ');
  }).join(', ');
}
function condWords(f) {
  const out = [];
  if (f.wspd != null) out.push(`Wind ${fmtWind(f)}`);
  const v = parseVis(f.visib); if (v != null) out.push(`Sicht ${fmtVis(v)}`);
  if (f.wxString) out.push(wxWords(f.wxString));
  if (f.clouds?.length) out.push(f.clouds.map((c) => c.base != null ? `${COV[c.cover] || c.cover} ${c.base} ft` : (COV[c.cover] || c.cover)).join(', '));
  return out.join(' · ') || 'keine Änderung angegeben';
}
const dh = (ms) => `${WD[new Date(ms).getUTCDay()]} ${p2(new Date(ms).getUTCHours())}${new Date(ms).getUTCMinutes() ? ':' + p2(new Date(ms).getUTCMinutes()) : ''}Z`;
function tafWordsHTML(taf) {
  taf = tafModel(taf);
  if (!taf?.fcsts?.length) return '<p class="detail">Kein TAF verfügbar.</p>';
  return `<ul class="words">${taf.fcsts.map((f, k) => {
    const ch = String(f.fcstChange || '').toUpperCase(), a = toMs(f.timeFrom), b = toMs(f.timeTo), e = toMs(f.timeBec);
    let lab;
    if (k === 0) lab = `${dh(a)} – ${dh(toMs(taf.validTimeTo) || b)}`;
    else if (ch === 'BECMG') lab = `Übergang ${dh(a)}–${dh(e || b)}`;
    else if (ch === 'TEMPO') lab = `${f.probability ? `${f.probability} % ` : ''}zeitweise ${dh(a)}–${dh(b)}`;
    else if (ch.startsWith('PROB') || f.probability) lab = `${f.probability || ch.slice(4)} % Wahrscheinlichkeit ${dh(a)}–${dh(b)}`;
    else lab = `ab ${dh(a)}`;
    return `<li><span class="w-lab">${esc(lab)}</span><span>${esc(condWords(f))}</span></li>`;
  }).join('')}</ul>`;
}

// ---------- Wetter zum Zeitpunkt des Flugs ----------
function minimaWhy(ceil, vis, w, s) {
  return [(ceil ?? Infinity) < s.minCeil && 'Wolken', (vis ?? 10) < s.minVis && 'Sicht',
    ((w?.wspd ?? 0) > s.maxWind || (w?.wgst ?? 0) > s.maxGust) && 'Wind'].filter(Boolean);
}
function evalAt(ap, hours, t, s) {
  const near = ap.metar && (!ap.metarSrc || ap.metarSrc.dist <= 30) ? ap.metar : null;
  const mt = near ? toMs(near.obsTime) : null;
  const day = sunAlt(ap.lat, ap.lon, t) >= -6;
  // METAR beschreibt „jetzt" – nur nutzen, wenn der Zeitpunkt höchstens 1 h entfernt ist
  if (near && Math.abs(t - Date.now()) <= H && mt > Date.now() - 2 * H) {
    const ceil = ceilOf(near.clouds), vis = parseVis(near.visib), w = wx(near), why = minimaWhy(ceil, vis, w, s);
    return { src: `METAR ${near.icaoId} ${hhmm(mt)}Z${ap.metarSrc ? ` (${ap.metarSrc.dist} km)` : ''}`, ceil, vis, wind: w, wxs: near.wxString || '', tempo: null, why, day,
      cat: category(ceil, vis), status: why.length ? 'below' : 'ok' };
  }
  const i = hourOf(t), h = i == null ? null : hours[i];
  if (!h || h.status === 'none') return { src: i == null ? 'außerhalb 48 h' : 'keine Daten', status: 'none', day };
  const src = h.src === 'TAF' ? `TAF ${ap.tafSrc ? `${ap.tafSrc.id} (${ap.tafSrc.dist} km)` : ap.id}` : 'Modellvorhersage';
  return { src, ceil: h.ceil, vis: h.vis, wind: h.wind, wxs: h.taf?.wx || '', tempo: h.taf?.tempo || null, why: h.why, day, cat: h.cat, status: h.status };
}
const statusText = (e) => e.closed ? 'geschlossen' : e.status === 'none' ? 'keine Daten' : !e.day && e.status === 'ok' ? 'Nacht' :
  e.status === 'ok' ? 'über Minima' : e.status === 'tempo' ? 'TEMPO unter Minima' : `unter Minima${e.why?.length ? ' (' + e.why.join(', ') + ')' : ''}`;
const statusCls = (e) => e.closed ? 'bad' : e.status === 'ok' && e.day ? 'ok' : e.status === 'none' ? 'none' : e.status === 'tempo' && e.day ? 'warn' : 'bad';

// Chronologische Liste: Abflug, Zwischenplätze, Ziel, Ausweichplatz
function alongHTML(all, fp, s, compact) {
  const byId = Object.fromEntries(all.map((x) => [x.ap.id, x]));
  const order = [...B.ids, ...(B.altId ? [B.altId] : [])];
  const legTo = Object.fromEntries([...fp.legs, ...(fp.altLeg ? [fp.altLeg] : [])].map((l) => [l.to, l]));
  return `<div class="along">${order.map((id) => {
    const x = byId[id], e = fp.eta[id];
    if (!x) return '';
    const { ap, hours } = x;
    const l = legTo[id];
    const leg = l ? `<div class="al-leg">${Math.round(l.dist)} NM · ${fmtDur(l.min)} · GS ${Math.round(l.gs)} kt${ap.isAlt ? ' · ab Ziel' : ''}</div>` : '';
    if (ap.error || !hours || !e) return `${leg}<div class="al-row al-bad"><div class="al-time"><b>–</b></div><div class="al-dot"></div><div class="al-main"><div class="al-head"><b>${esc(id)}</b></div><div class="warn">${esc(ap.error || 'Keine Zeit berechnet')}</div></div></div>`;
    const v = evalAt(ap, hours, e.t, s);
    const open = typeof isOpen === 'function' ? isOpen(ap, e.t) : null, info = typeof apInfo === 'function' ? apInfo(id) : null;
    if (open === false) { v.closed = true; }
    const opl = info ? `<div class="al-src">Öffnungszeit: ${esc(hoursText(id))}${open === false ? ' – <b class="bad">zu dieser Zeit geschlossen</b>' : open === null ? ' – nicht geprüft' : ''}${info.ppr ? ' · <b>PPR</b>' : ''}</div>` : '';
    const wxl = v.status === 'none' ? '' : [`Wolken ${v.ceil === Infinity ? 'keine Untergrenze' : fmtCeil(v.ceil)}`, `Sicht ${fmtVis(v.vis)}`, v.wind ? `Wind ${fmtWind(v.wind)}` : '', v.wxs ? wxWords(v.wxs) : ''].filter(Boolean).join(' · ');
    return `${leg}<div class="al-row al-${statusCls(v)}${ap.isAlt ? ' alt' : ''}">
      <div class="al-time"><b>${hhmm(e.t)}Z</b><span>${e.kind}</span></div>
      <div class="al-dot"></div>
      <div class="al-main">
        <div class="al-head"><b>${esc(id)}</b> <span class="al-name">${esc(ap.name)}</span>${v.cat ? ` <span class="pill cat-${v.cat}">${v.cat}</span>` : ''}<span class="status ${statusCls(v)}">${statusText(v)}</span></div>
        ${wxl ? `<div class="al-wx">${wxl}</div>` : ''}
        ${v.tempo ? `<div class="al-tempo">Zeitweise (TEMPO): Wolken ${fmtCeil(v.tempo.ceil)} · Sicht ${fmtVis(v.tempo.vis)}${v.tempo.wx ? ' · ' + wxWords(v.tempo.wx) : ''}</div>` : ''}
        ${compact ? '' : `<div class="al-src">Quelle: ${esc(v.src)}</div>`}${opl}
      </div>
    </div>`;
  }).join('')}</div>`;
}

const CHECKS_HTML = (fp) => {
  const ck = checks();
  return `<ul class="group checklist">${CHECKS.map(([k, t]) => `<li><label class="row check-row"><input type="checkbox" class="check" data-c="${k}"${ck[k] ? ' checked' : ''}><span>${esc(t)}${k === 'fuel' && fp?.legs.length ? ` <b class="num">(${Math.ceil(fp.total)} l)</b>` : ''}${k === 'alt' && B?.altId ? ` <b>(${esc(B.altId)})</b>` : ''}</span></label></li>`).join('')}
    <li class="noprint"><button class="row center" id="ckReset">Häkchen zurücksetzen</button></li></ul>
  <p class="group-note noprint">Links: <a href="https://www.flugwetter.de" target="_blank" rel="noopener">DWD Flugwetter</a> · <a href="https://aip.dfs.de" target="_blank" rel="noopener">DFS AIP</a> · <a href="https://secais.dfs.de" target="_blank" rel="noopener">DFS NOTAM</a></p>`;
};

function bannersHTML() {
  const age = Math.round((Date.now() - B.fetchedAt) / 6e4);
  return `${B.demo ? '<p class="banner demo">Beispieldaten – kein echtes Wetter</p>' : ''}
  ${B.dataAt && B.fetchedAt - B.dataAt > 45 * 6e4 ? `<p class="banner">METAR/TAF-Stand ${hhmm(B.dataAt)}Z ist ${Math.round((B.fetchedAt - B.dataAt) / 6e4)} min alt – GitHub hat die Aktualisierung verzögert. Aktuelles METAR/TAF vor dem Flug zusätzlich prüfen.</p>` : ''}
  ${age > 30 ? `<p class="banner noprint">Daten sind ${age < 120 ? age + ' min' : Math.round(age / 60) + ' h'} alt – oben rechts <b>aktualisieren</b>.</p>` : ''}
  ${B.errors?.length ? `<p class="banner">${B.errors.map(esc).join(' · ')}</p>` : ''}`;
}

// Schieberegler + Grafiken + Zeitleiste verbinden (für Wetter-Tab und Briefing)
function mountTimeControls(all) {
  const slider = $('slider'); if (!slider) return;
  const setSel = (i) => {
    sel = Math.max(0, Math.min(SPAN - 1, i));
    slider.value = sel;
    slider.style.setProperty('--p', `${(sel / (SPAN - 1)) * 100}%`);
    $('detail').innerHTML = detailHTML(all);
    document.querySelectorAll('[data-sel]').forEach((r) => {
      const svg = r.ownerSVGElement; r.setAttribute('x', +svg.dataset.l + (sel / SPAN) * +svg.dataset.pw);
    });
    document.querySelectorAll('.tl-c').forEach((c) => c.classList.toggle('sel', +c.dataset.i === sel));
  };
  slider.addEventListener('input', (e) => setSel(+e.target.value));
  document.querySelectorAll('.tl-c').forEach((c) => c.addEventListener('click', () => setSel(+c.dataset.i)));
  document.querySelectorAll('svg.chart[data-l]').forEach((svg) => svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * +svg.dataset.w;
    setSel(Math.floor(((vx - +svg.dataset.l) / +svg.dataset.pw) * SPAN));
  }));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () =>
    $('ap-' + b.dataset.go)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })));
  setSel(sel);
}
const keepScroll = () => { const st = $('scroll').scrollTop; route(); $('scroll').scrollTop = st; };

// ---------- Tab „Wetter" ----------
function wetterView() {
  const recent = store.get('recentWx', []);
  let html = `
  <form class="search" id="wf">
    <label class="field">${SYM.search}<input id="wid" type="text" maxlength="4" placeholder="Flugplatz, z. B. EDDN" value="${esc(V?.ids?.[0] || '')}" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Flugplatz (ICAO)"></label>
    <button class="btn-fill" type="submit">Anzeigen</button>
  </form>
  ${recent.length ? `<div class="chips">${recent.map((id) => `<button class="chip" data-w="${esc(id)}">${esc(id)}</button>`).join('')}</div>` : ''}`;
  if (loading === 'wx') return html + `<div class="empty"><div class="spinner"></div><p>Lade METAR, TAF und Vorhersage …</p></div>`;
  if (!V) return html + `<div class="empty">${ICONS.cloud}<h3>Wetter an einem Platz</h3><p>Gib eine ICAO-Kennung ein, z. B. EDDN, und tippe auf „Anzeigen". Für einen Flug über mehrere Plätze nimm den Tab „Flug".</p></div>`;
  const s = settings();
  const ap = V.airports[0];
  const hours = ap.error ? null : computeHours(ap, V.start, s);
  const all = [{ ap, hours }];
  html += `<p class="meta">abgerufen ${utc(V.fetchedAt)}${V.dataAt ? ` · METAR/TAF-Stand ${hhmm(V.dataAt)}Z` : ''}</p>${bannersHTML()}
  ${tilesHTML(all, null)}`;
  if (!hours) return html;
  html += `
  <h2 class="sec">TAF in Worten</h2>
  <div class="card">${ap.taf ? `${ap.tafSrc ? `<p class="detail">TAF von ${esc(ap.tafSrc.id)}, ${ap.tafSrc.dist} km entfernt${ap.tafUse ? '' : ' – zu weit, Grafik nutzt das Modell'}</p>` : ''}${tafWordsHTML(ap.taf)}` : '<p class="detail">Kein TAF in der Nähe – nur Modellvorhersage.</p>'}</div>
  <div class="card pick">
    <input type="range" id="slider" min="0" max="${SPAN - 1}" step="1" value="${sel}" aria-label="Stunde wählen">
    <div id="detail">${detailHTML(all)}</div>
  </div>
  <h2 class="sec">48 Stunden</h2>
  ${airportCard(ap, hours, s, null)}
  <p class="foot">Quellen: METAR/TAF aviationweather.gov (NOAA), Flugplätze OurAirports, Modell Open-Meteo. Keine amtliche Flugwetterberatung.</p>`;
  return html;
}
function wetterMount() {
  $('wf').addEventListener('submit', (e) => { e.preventDefault(); const id = parseIds($('wid').value)[0]; $('wid').blur(); if (id) loadWx(id); });
  document.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => loadWx(b.dataset.w)));
  $('reload')?.addEventListener('click', () => V?.ids?.[0] && loadWx(V.ids[0]));
  if (!V || loading) return;
  const ap = V.airports[0];
  if (!ap.error) mountTimeControls([{ ap, hours: computeHours(ap, V.start, settings()) }]);
}

// ---------- Tab „Flug": drei Schritte ----------
const FLIGHT_DEFAULT = { from: '', via: [], to: '', alt: '' };
const flightIn = () => ({ ...FLIGHT_DEFAULT, ...store.get('flight', {}) });
const flightIds = (f) => [f.from, ...f.via, f.to].map((x) => (x || '').trim().toUpperCase()).filter((x) => /^[A-Z0-9]{4}$/.test(x));
function planFormHTML(p) {
  const dep = depMs(p), d0 = new Date();
  const days = [0, 1, 2].map((k) => { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + k)); return `<option value="${k}"${+p.depDay === k ? ' selected' : ''}>${['Heute', 'Morgen', 'Übermorgen'][k]}, ${dayLabel(d.getTime())}</option>`; }).join('');
  const num = (k, label, unit, val, step = 1) => `<li><label class="row"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" data-p="${k}" value="${val}" step="${step}" min="0"> ${unit}</span></label></li>`;
  return `
  <p class="group-label">Flugzeug</p>
  <ul class="group">
    <li><label class="row"><span>Typ</span><select data-p="ac">${Object.entries(AIRCRAFT).map(([k, a]) => `<option value="${k}"${k === p.ac ? ' selected' : ''}>${a.name}</option>`).join('')}</select></label></li>
    ${num('tas', 'Reisegeschwindigkeit (TAS)', 'kt', p.tas)}
    ${num('burn', 'Verbrauch', 'l/h', p.burn)}
    <li><div class="row"><span>Kraftstoff</span><span class="detail">${esc(p.acData.fuel)}</span></div></li>
    ${p.custom[p.ac] ? '<li><button class="row center" id="acReset">Werte des Typs wiederherstellen</button></li>' : ''}
  </ul>
  <p class="group-note">Richtwerte bei ca. 65–75 % Leistung. Mit dem Flughandbuch (POH/AFM) deines Flugzeugs abgleichen und hier anpassen.</p>
  <p class="group-label">Abflug und Flug</p>
  <ul class="group">
    <li><label class="row"><span>Abflug Tag</span><select data-p="depDay">${days}</select></label></li>
    <li><label class="row"><span>Abflug Zeit (UTC)</span><input type="time" data-p="depTime" value="${p.depTime || hhmm(dep)}"></label></li>
    ${num('alt', 'Reiseflughöhe', 'ft MSL', p.alt, 500)}
    <li><label class="row"><span>Höhenwind einrechnen</span><input type="checkbox" class="switch" data-p="useWind"${p.useWind ? ' checked' : ''}></label></li>
    ${num('allow', 'Zuschlag je Etappe', 'min', p.allow)}
    ${num('stop', 'Aufenthalt je Zwischenlandung', 'min', p.stop, 5)}
    ${num('reserve', 'Reserve', 'min', p.reserve, 5)}
    ${num('taxi', 'Rollen je Start', 'l', p.taxi)}
  </ul>
  <p class="group-note">Zuschlag: Steigflug, Abflug- und Anflugverfahren. Aufenthalt 0 = Zwischenplätze werden nur überflogen. mwK mit genäherter Missweisung (ca. 3–5° Ost in Deutschland).</p>`;
}
function planFormMount() {
  document.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('change', () => {
    const st = store.get('plan', {}), k = el.dataset.p;
    st.custom = st.custom || {};
    if (k === 'tas' || k === 'burn') {
      const ac = st.ac || PLAN_DEFAULTS.ac;
      st.custom[ac] = { ...(st.custom[ac] || {}), [k]: Math.max(1, parseFloat(el.value) || 1) };
    } else if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.type === 'number') st[k] = Math.max(0, parseFloat(el.value) || 0);
    else st[k] = el.value;
    store.set('plan', st); keepScroll();
  }));
  $('acReset')?.addEventListener('click', () => { const st = store.get('plan', {}); delete st.custom?.[plan().ac]; store.set('plan', st); keepScroll(); });
  // Abflugzeit aus den möglichen Fenstern übernehmen
  document.querySelectorAll('[data-dep]').forEach((b) => b.addEventListener('click', () => {
    const t = +b.dataset.dep, d = new Date(t), n = new Date();
    const day = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 864e5);
    const st = store.get('plan', {}); st.depDay = Math.max(0, Math.min(2, day)); st.depTime = hhmm(t); store.set('plan', st); keepScroll();
  }));
}
function windowsHTML(win, p, tappable) {
  return `<div class="card wincard ${win.length ? 'ok' : 'bad'}">
    <span class="wc-icon">${win.length ? SYM.ok : SYM.warn}</span>
    <div><div class="wc-title">${win.length ? 'Mögliche Abflugzeiten' : 'Keine passende Abflugzeit in 48 h'}</div>
      <div class="wc-sub">Abflug, Ankunft${B.profile ? ' und Strecke' : ''} über deinen Minima, bei Tageslicht und innerhalb eingetragener Öffnungszeiten – mit ${esc(p.acData.name)}${tappable && win.length ? '. Antippen übernimmt die Zeit.' : ''}</div>
      ${win.length ? `<div class="wins">${win.map(([a, b]) => `<button class="win${tappable ? '' : ' static'}" data-dep="${a}">${WD[new Date(a).getUTCDay()]} ${hhmm(a)}${b > a ? '–' + hhmm(b) : ''} UTC</button>`).join('')}</div>` : ''}
    </div>
  </div>`;
}
const flightData = () => {
  const s = settings(), p = plan();
  const all = B.airports.map((ap) => ({ ap, hours: ap.error ? null : computeHours(ap, B.start, s) }));
  const ok = all.filter((x) => x.hours);
  const fp = flightPlan(depMs(p), p);
  const routeOk = ok.filter((x) => !x.ap.isAlt);
  return { s, p, all, ok, fp, win: routeOk.length ? depWindows(routeOk, p, s) : [] };
};
const routeLine = () => `<p class="meta">${esc(B.ids.join(' → '))}${B.altId ? ` · Ausweich ${esc(B.altId)}` : ''} · Wetter abgerufen ${utc(B.fetchedAt)}${B.dataAt ? ` · METAR/TAF-Stand ${hhmm(B.dataAt)}Z` : ''}</p>`;

// PDF: Druckansicht des Browsers (am iPad: Teilen › Drucken › Als PDF sichern / Teilen)
function exportPDF() {
  const now = Date.now();
  const el = $('exportTime'); if (el) el.textContent = `${utc(now)} (${local(now)} Ortszeit)`;
  const d = new Date(now);
  const old = document.title;
  document.title = `FlightPrep ${B.ids.join('-')} ${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`;
  setTimeout(() => { window.print(); setTimeout(() => { document.title = old; }, 1000); }, 50);
}
addEventListener('beforeprint', () => { const el = $('exportTime'); if (el && !el.textContent) el.textContent = `${utc(Date.now())} (${local(Date.now())} Ortszeit)`; });
addEventListener('afterprint', () => { const el = $('exportTime'); if (el) el.textContent = ''; });

// ---------- Beispieldaten (zum Ausprobieren ohne Internet) ----------
function makeDemo() {
  const start = Math.floor(Date.now() / H) * H, s0 = start / 1000;
  const GH = { 1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4200 };
  const model = (shift, elev) => {
    const time = [], hr = { visibility: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [] };
    LEVELS.forEach((L) => { hr[`cloud_cover_${L}hPa`] = []; hr[`geopotential_height_${L}hPa`] = []; hr[`wind_speed_${L}hPa`] = []; hr[`wind_direction_${L}hPa`] = []; });
    for (let i = -2; i < 60; i++) {
      const t = start + i * H, d = new Date(t);
      time.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:00`);
      const c = 2600 + 1400 * Math.sin((i + shift) / 7) - (i > 18 && i < 30 ? 1700 : 0);
      LEVELS.forEach((L) => { hr[`geopotential_height_${L}hPa`].push(GH[L]); hr[`cloud_cover_${L}hPa`].push((GH[L] - elev) * FT >= c ? 85 : 15); });
      hr.visibility.push(i > 20 && i < 28 ? 4000 : 24000);
      hr.wind_speed_10m.push(8 + 10 * Math.max(0, Math.sin((i + shift) / 5)));
      hr.wind_direction_10m.push(230 + i * 2);
      hr.wind_gusts_10m.push(14 + 16 * Math.max(0, Math.sin((i + shift) / 5)));
      LEVELS.forEach((L) => { hr[`wind_speed_${L}hPa`].push(18 + 12 * Math.sin(i / 9) + (1000 - L) / 30); hr[`wind_direction_${L}hPa`].push(250 + i); });
    }
    return { time, ...hr };
  };
  const cl = (s) => s.split(' ').map((x) => ({ cover: x.slice(0, 3), base: +x.slice(3) * 100 }));
  const taf = (id, txt) => ({
    icaoId: id, issueTime: new Date(start - H).toISOString(), validTimeFrom: s0, validTimeTo: s0 + 30 * 3600, rawTAF: txt,
    fcsts: [
      { timeFrom: s0, timeTo: s0 + 10 * 3600, wdir: 240, wspd: 12, visib: '6+', clouds: cl('SCT025 BKN040') },
      { fcstChange: 'TEMPO', timeFrom: s0 + 4 * 3600, timeTo: s0 + 9 * 3600, visib: 2.5, clouds: cl('BKN012'), wxString: 'SHRA' },
      { fcstChange: 'BECMG', timeFrom: s0 + 10 * 3600, timeTo: s0 + 12 * 3600, clouds: cl('BKN018'), visib: '6+', wdir: 250, wspd: 16, wgst: 28 },
      { fcstChange: 'FM', timeFrom: s0 + 20 * 3600, timeTo: s0 + 30 * 3600, wdir: 270, wspd: 10, visib: 3.1, clouds: cl('OVC008') },
    ],
  });
  const raw = (id) => `TAF ${id} 071100Z 0712/0818 24012KT 9999 SCT025 BKN040 TEMPO 0716/0721 4000 SHRA BKN012 BECMG 0722/0800 25016G28KT BKN018 FM080800 27010KT 5000 OVC008`;
  const metar = (id, lat, lon) => ({ icaoId: id, obsTime: s0 - 600, lat, lon, rawOb: `METAR ${id} 071450Z 24011KT 9999 FEW020 BKN035 12/07 Q1014 NOSIG`, wdir: 240, wspd: 11, visib: '6+', temp: 12, dewp: 7, altim: 1014, clouds: cl('FEW020 BKN035') });
  const d1 = distKm(49.96, 8.64, 49.82, 9.90) / 1.852, D = d1 + distKm(49.82, 9.90, 49.98, 11.64) / 1.852;
  const aps = [[0, 'EDFE'], [d1, 'EDFW'], [D, 'EDQD']];
  const profile = {
    D, marks: aps.map(([d, id]) => ({ id, d })),
    terrain: Array.from({ length: 200 }, (_, i) => { const d = (D * i) / 199; return { d, e: Math.round(400 + 1400 * Math.exp(-(((d - 30) / 9) ** 2)) + 900 * Math.sin(d / 7) ** 2 + 1700 * Math.exp(-(((d - 125) / 10) ** 2))) }; }),
    pts: Array.from({ length: 24 }, (_, i) => { const d = (D * i) / 23; return { d, c: Array.from({ length: SPAN }, (_, h) => Math.round(4600 + 1200 * Math.sin((h + d / 20) / 7) - (h > 18 && h < 30 ? 1500 : 0) + (d > 100 ? 600 : 0))) }; }),
  };
  return {
    profile, fetchedAt: Date.now(), start, demo: true, errors: [], ids: ['EDFE', 'EDFW', 'EDQD'],
    airports: [
      { id: 'EDFE', name: 'Frankfurt-Egelsbach', lat: 49.96, lon: 8.64, metar: metar('EDDF', 50.03, 8.57), metarSrc: { id: 'EDDF', dist: 9 }, taf: taf('EDDF', raw('EDDF')), tafSrc: { id: 'EDDF', dist: 9 }, tafUse: true, model: model(0, 117), modelElev: 117, notes: [] },
      { id: 'EDFW', name: 'Würzburg-Schenkenturm', lat: 49.82, lon: 9.90, metar: null, taf: null, tafUse: false, model: model(2, 300), modelElev: 300, notes: ['Kein eigenes METAR/TAF – Grafik nutzt das Modell.'] },
      { id: 'EDQD', name: 'Bayreuth', lat: 49.98, lon: 11.64, metar: null, taf: null, tafUse: false, model: model(5, 487), modelElev: 487, notes: ['Kein METAR/TAF in der Nähe gefunden.'] },
    ],
  };
}

// =====================================================================
// FlightPrep – Module: 1 Flug · 2 Wetter · 3 NOTAM · 4 Kraftstoff · 5 Masse & Schwerpunkt · 6 Checkliste · Briefing
// =====================================================================

// ---------- Dateien (Karten, NOTAM-Anhänge) im Gerät: IndexedDB ----------
const files = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('flightprep', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('files', mode), req = fn(t.objectStore('files'));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
    });
  },
  put(k, v) { return this.run('readwrite', (s) => s.put(v, k)); },
  get(k) { return this.run('readonly', (s) => s.get(k)); },
  del(k) { return this.run('readwrite', (s) => s.delete(k)); },
  async list(prefix) { const keys = (await this.run('readonly', (s) => s.getAllKeys())) || []; return keys.filter((k) => String(k).startsWith(prefix)).sort(); },
};
async function readFile(file) {
  if (file.type.startsWith('image/')) {
    const img = await createImageBitmap(file);
    const sc = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { name: file.name, type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85), at: Date.now() };
  }
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  return { name: file.name, type: file.type || 'application/octet-stream', data, at: Date.now() };
}
// Liste von Dateien anzeigen (Bilder als Vorschau, PDFs als Link) – wird nach dem Rendern befüllt
const filesBox = (prefix, editable) => `<div class="files" data-files="${esc(prefix)}" data-edit="${editable ? 1 : 0}"></div>`;
async function fillFiles(root = document) {
  for (const box of root.querySelectorAll('[data-files]')) {
    const keys = await files.list(box.dataset.files).catch(() => []);
    const items = await Promise.all(keys.map(async (k) => ({ k, f: await files.get(k) })));
    box.innerHTML = items.length ? items.map(({ k, f }) => `<figure class="file">
        ${f.type.startsWith('image/') ? `<img src="${f.data}" alt="${esc(f.name)}">` : `<a class="file-doc" href="${f.data}" download="${esc(f.name)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`}
        <figcaption>${esc(f.name)} · ${utc(f.at)}${box.dataset.edit === '1' ? ` <button class="btn-text danger-text noprint" data-fdel="${esc(k)}">Entfernen</button>` : ''}</figcaption>
      </figure>`).join('') : (box.dataset.edit === '1' ? '<p class="detail">Noch keine Dateien.</p>' : '');
    box.querySelectorAll('[data-fdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Datei entfernen?')) return; await files.del(b.dataset.fdel); fillFiles(box.parentElement);
    }));
  }
}
function bindUpload(input, prefix, after) {
  input?.addEventListener('change', async () => {
    for (const f of input.files) { const v = await readFile(f); await files.put(`${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, v); }
    input.value = ''; after ? after() : fillFiles();
  });
}

// ---------- Flugplatz-Infos aus der AIP (vom Nutzer eingetragen) ----------
const apInfo = (id) => ({ mode: 'unknown', open: '', close: '', ppr: false, notes: '', checkedAt: null, ...(store.get('apinfo', {})[id] || {}) });
function setApInfo(id, patch) { const all = store.get('apinfo', {}); all[id] = { ...apInfo(id), ...patch, checkedAt: Date.now() }; store.set('apinfo', all); }
// Ist der Platz zur Zeit t geöffnet? null = unbekannt
function isOpen(ap, t) {
  const i = apInfo(ap.id);
  if (i.mode === 'h24') return true;
  if (i.mode === 'srss') return sunAlt(ap.lat, ap.lon, t) >= -0.833;
  if (i.mode === 'times' && /^\d{2}:\d{2}$/.test(i.open) && /^\d{2}:\d{2}$/.test(i.close)) {
    const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes();
    const [a, b] = [i.open, i.close].map((s) => +s.slice(0, 2) * 60 + +s.slice(3));
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }
  return null;
}
const hoursText = (id) => { const i = apInfo(id);
  return i.mode === 'h24' ? 'H24' : i.mode === 'srss' ? 'SR–SS' : i.mode === 'times' && i.open && i.close ? `${i.open}–${i.close} UTC` : 'nicht eingetragen'; };

// ---------- Masse & Schwerpunkt: Typdaten mit Quellen ----------
// status: 'belegt' = in mindestens einer Quelle gefunden · 'leer' = keine belastbare Quelle gefunden, bitte aus dem Handbuch eintragen
// Leermasse/-hebelarm sind immer flugzeugspezifisch (Wägebericht)!
const WB_TYPES = {
  C152: { unit: 'lb', armUnit: 'in', mtow: 1670, fuelArm: 42.2, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Pilot + Beifahrer', arm: 39.0 }, { k: 'bag1', name: 'Gepäck Bereich 1', arm: 64.0 }, { k: 'bag2', name: 'Gepäck Bereich 2', arm: 84.0 }],
    baggageMax: 120, env: [[1000, 31.0], [1350, 31.0], [1670, 32.6], [1670, 36.5], [1000, 36.5]],
    sample: { mass: 1140.7, arm: 32.89, src: 'Beispiel-Flugzeug N152UF (WVFC)' },
    src: ['WVFC W&B-Rechner (Hüllkurve, Hebelarme, MTOW): tools.wvfc.org', 'Cessna 152 W&B-Blatt (Hebelarme 39/42,2/64/84): fasclub.com'],
    notes: 'Hüllkurve aus Vereinsrechner abgeleitet. Mit Abschnitt 6 deines POH abgleichen.' },
  C172: { unit: 'lb', armUnit: 'in', mtow: 2550, fuelArm: null, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Pilot + Beifahrer', arm: null }, { k: 'rear', name: 'Rücksitze', arm: null }, { k: 'bag1', name: 'Gepäck A', arm: null }, { k: 'bag2', name: 'Gepäck B', arm: null }],
    baggageMax: 120, env: [],
    sample: { mass: 1663, arm: null, src: 'Standard-Leermasse 172S NAV III (POH), Hebelarm nicht gefunden' },
    src: ['Cessna 172S POH (MTOW 2550 lb, Gepäck A+B max. 120 lb, Standard-Leermasse 1663 lb)'],
    notes: 'Hebelarme und Hüllkurve konnte ich nicht belastbar belegen – bitte aus Abschnitt 6 des POH eintragen (gilt für 172S; andere Varianten abweichend).' },
  PS28: { unit: 'kg', armUnit: 'mm', mtow: 600, fuelArm: null, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Pilot + Beifahrer', arm: null }, { k: 'bag1', name: 'Gepäck hinten (max. 18 kg)', arm: null }, { k: 'bag2', name: 'Gepäck Flügelfächer (je max. 10 kg)', arm: null }],
    baggageMax: null, env: [],
    sample: { mass: 387.0, arm: 432.4, src: 'Beladebeispiel im PS-28 POH (Bezugsebene Flügelvorderkante)' },
    src: ['PS-28 Cruiser POH PS-POH-1-1-12 (MTOW 600 kg, Gepäck 18 kg + 2×10 kg, Schwerpunkt 28–35 % MAC)'],
    notes: 'Der POH gibt die Grenzen in % MAC an. Ohne belegte MAC-Werte kann ich sie nicht in mm umrechnen – Hebelarme und Grenzen bitte aus dem POH eintragen. Kraftstoffdichte: 0,72 für AvGas; bei MoGas anpassen.' },
  PA28: { unit: 'lb', armUnit: 'in', mtow: 2550, fuelArm: 95.0, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Vordersitze', arm: null }, { k: 'rear', name: 'Rücksitze', arm: 118.1 }, { k: 'bag1', name: 'Gepäck (max. 200 lb)', arm: 142.8 }],
    baggageMax: 200, env: [],
    sample: null,
    src: ['PA-28-181 Rechner metarcentral/aviatize (Hebelarme hinten 118,1 / Gepäck 142,8 / Kraftstoff 95,0)', 'Archer II POH (MTOW 2550 lb, Gepäck max. 200 lb, hintere Grenze 93,0 in)'],
    notes: 'Vordersitze: Quellen nennen 80,5 oder 85,5 in (sitzabhängig). Vordere Schwerpunktgrenze bei 2550 lb widersprüchlich (83–88,6 in). Bitte beides aus deinem POH eintragen. Gilt nur für PA-28-181.' },
  SR22: { unit: 'lb', armUnit: 'in', mtow: 3400, fuelArm: 154.9, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Vordersitze', arm: 143.5 }, { k: 'rear', name: 'Rücksitze', arm: 180.0 }, { k: 'bag1', name: 'Gepäck (max. 130 lb)', arm: 208.0 }],
    baggageMax: 130, env: [[2100, 137.8], [2700, 139.1], [3400, 142.3], [3400, 148.1], [2100, 148.1]],
    sample: { mass: 2357, arm: 138.0, src: 'Beispiel-Flugzeug N809SR (WVFC)' },
    src: ['WVFC W&B-Rechner SR22 N809SR (Hebelarme, MTOW 3400 lb, Hüllkurve)'],
    notes: 'Gilt für SR22 mit 3400 lb MTOW (ältere Baureihen). Neuere SR22 haben 3600 lb und eine andere Hüllkurve – mit POH abgleichen.' },
  TB20: { unit: 'kg', armUnit: 'm', mtow: 1400, fuelArm: null, fuelDensity: 0.72, usableFuel: null,
    stations: [{ k: 'front', name: 'Vordersitze', arm: null }, { k: 'rear', name: 'Rücksitze', arm: null }, { k: 'bag1', name: 'Gepäck (max. 65 kg)', arm: null }],
    baggageMax: 65, env: [],
    sample: { mass: 800, arm: null, src: 'Standard-Leermasse vor MOD.151 laut POH (nach MOD.151: 823 kg), Hebelarm nicht gefunden' },
    src: ['Socata TB20 Pilot\'s Information Manual (MTOW 1400 kg, Gepäck max. 65 kg, Leermasse 800/823 kg)'],
    notes: 'Hebelarme und Hüllkurve nicht belastbar gefunden (Teilwerte 0,913 m / 1,205 m ohne eindeutige Zuordnung) – bitte aus Abschnitt 6 eintragen.' },
  DA40: { unit: 'kg', armUnit: 'm', mtow: 1280, fuelArm: 2.63, fuelDensity: 0.80, usableFuel: null,
    stations: [{ k: 'front', name: 'Vordersitze', arm: 2.30 }, { k: 'rear', name: 'Rücksitze', arm: 3.25 }, { k: 'bag1', name: 'Gepäckraum', arm: 3.65 }, { k: 'bag2', name: 'Gepäckerweiterung', arm: 4.54 }],
    baggageMax: null, env: [],
    sample: null,
    src: ['DA40 NG AFM (Hebelarme 2,30/3,25/3,65/4,54 m, Kraftstoff 2,63 m, MTOM 1280 kg bzw. 1310 kg mit MÄM 40-662)'],
    notes: 'Hüllkurve nicht gefunden – bitte aus dem AFM eintragen. Jet A-1: Dichte laut Spezifikation 0,775–0,840 kg/l, hier 0,80 angenommen.' },
};
const LB = 2.20462;
const wbType = (ac) => {
  const base = WB_TYPES[ac] || WB_TYPES.C172, ov = store.get('wbTypes', {})[ac] || {};
  const st = base.stations.map((s) => ({ ...s, arm: ov.arms?.[s.k] ?? s.arm, edited: ov.arms?.[s.k] != null }));
  return { ...base, ...ov, stations: st, env: ov.env ?? base.env, edited: !!Object.keys(ov).length };
};
const wbFlight = () => ({ emptyMass: null, emptyArm: null, front: 0, rear: 0, bag1: 0, bag2: 0, ...store.get('wbFlight', {})[plan().ac] });
function setWbFlight(patch) { const all = store.get('wbFlight', {}); const ac = plan().ac; all[ac] = { ...wbFlight(), ...patch }; store.set('wbFlight', all); }

// Punkt in Polygon (Masse, Arm)
function inEnvelope(env, mass, arm) {
  if (!env || env.length < 3) return null;
  let inside = false;
  for (let i = 0, j = env.length - 1; i < env.length; j = i++) {
    const [mi, ai] = env[i], [mj, aj] = env[j];
    if ((mi > mass) !== (mj > mass) && arm < ((aj - ai) * (mass - mi)) / (mj - mi) + ai) inside = !inside;
  }
  return inside;
}

// ---------- Kraftstoff ----------
const fuelIn = () => ({ onBoard: null, extraMin: 0, withAlt: false, ...store.get('fuel', {}) });
function fuelCalc(fp, p) {
  const f = fuelIn();
  const alt = f.withAlt && fp.altLeg ? fp.altLeg.fuel : 0;
  const extra = (f.extraMin / 60) * p.burn;
  const required = fp.trip + fp.taxi + fp.reserve + alt + extra;
  const onBoard = f.onBoard != null ? +f.onBoard : null;
  const takeoff = onBoard != null ? Math.max(0, onBoard - fp.taxi) : null;
  const landing = takeoff != null ? Math.max(0, takeoff - fp.trip) : null;
  return { ...f, alt, extra, required, onBoard, takeoff, landing, ok: onBoard != null ? onBoard >= required : null,
    endurance: onBoard != null ? ((onBoard - fp.taxi) / p.burn) * 60 : null };
}

// ---------- Masse & Schwerpunkt berechnen ----------
function wbCalc(p, fc) {
  const T = wbType(p.ac), W = wbFlight(), lbType = T.unit === 'lb';
  const toU = (kg) => (lbType ? kg * LB : kg); // kg → Einheit des Typs
  const items = [];
  const missing = [];
  const emptyMass = W.emptyMass ?? T.sample?.mass ?? null, emptyArm = W.emptyArm ?? T.sample?.arm ?? null;
  const emptyIsSample = W.emptyMass == null || W.emptyArm == null;
  if (emptyMass == null || emptyArm == null) missing.push('Leermasse/Hebelarm');
  items.push({ name: 'Leermasse', mass: emptyMass, arm: emptyArm, sample: emptyIsSample });
  T.stations.forEach((s) => {
    const m = toU(+W[s.k] || 0);
    if (m > 0 && s.arm == null) missing.push(`Hebelarm ${s.name}`);
    items.push({ name: s.name, mass: m, arm: s.arm, kg: +W[s.k] || 0 });
  });
  const fuelKg = (l) => (l == null ? null : l * (T.fuelDensity || 0.72));
  const fuelTo = fuelKg(fc.takeoff), fuelLd = fuelKg(fc.landing);
  if (fc.takeoff == null) missing.push('Kraftstoff an Bord (Modul 4)');
  if (T.fuelArm == null && fc.takeoff) missing.push('Hebelarm Kraftstoff');
  const sum = (fuelU) => {
    let m = 0, mom = 0, ok = true;
    for (const it of items) { if (it.mass == null) { ok = false; continue; } m += it.mass; if (it.mass > 0) { if (it.arm == null) ok = false; else mom += it.mass * it.arm; } }
    if (fuelU != null) { m += fuelU; if (fuelU > 0) { if (T.fuelArm == null) ok = false; else mom += fuelU * T.fuelArm; } }
    return { mass: m, arm: ok && m ? mom / m : null };
  };
  const to = sum(fuelTo != null ? toU(fuelTo) : null), ld = sum(fuelLd != null ? toU(fuelLd) : null);
  const envOk = T.env.length >= 3;
  if (!envOk) missing.push('Schwerpunkt-Hüllkurve');
  const check = (r) => ({ ...r, overMtow: T.mtow != null && r.mass > T.mtow, inEnv: r.arm != null && envOk ? inEnvelope(T.env, r.mass, r.arm) : null });
  return { T, W, items, fuelTo: fuelTo != null ? toU(fuelTo) : null, fuelLd: fuelLd != null ? toU(fuelLd) : null, to: check(to), ld: check(ld), missing, emptyIsSample };
}

function envelopeSVG(wb) {
  const { T, to, ld } = wb; if (T.env.length < 3) return '';
  const pts = [...T.env, ...(to.arm != null ? [[to.mass, to.arm]] : []), ...(ld.arm != null ? [[ld.mass, ld.arm]] : [])];
  const ms = pts.map((q) => q[0]), as = pts.map((q) => q[1]);
  const mMin = Math.min(...ms) * 0.95, mMax = Math.max(...ms) * 1.03, aMin = Math.min(...as), aMax = Math.max(...as), pad = (aMax - aMin) * 0.12 || 1;
  const W = 640, Hh = 360, L = 64, R = 16, Tp = 16, B = 44;
  const x = (a) => L + ((a - (aMin - pad)) / (aMax - aMin + 2 * pad)) * (W - L - R);
  const y = (m) => Tp + (1 - (m - mMin) / (mMax - mMin)) * (Hh - Tp - B);
  let g = `<polygon class="wb-env" points="${T.env.map(([m, a]) => `${x(a).toFixed(1)},${y(m).toFixed(1)}`).join(' ')}"/>`;
  const step = (mMax - mMin) > 600 ? 200 : (mMax - mMin) > 250 ? 100 : 50;
  for (let m = Math.ceil(mMin / step) * step; m <= mMax; m += step) g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text class="ch-label" x="${L - 6}" y="${y(m) + 4}" text-anchor="end">${m}</text>`;
  const astep = (aMax - aMin + 2 * pad) > 20 ? 5 : (aMax - aMin + 2 * pad) > 4 ? 1 : (aMax - aMin + 2 * pad) > 0.6 ? 0.1 : 0.05;
  for (let a = Math.ceil((aMin - pad) / astep) * astep; a <= aMax + pad; a += astep) g += `<text class="ch-label" x="${x(a)}" y="${Hh - B + 18}" text-anchor="middle">${+a.toFixed(2)}</text>`;
  if (T.mtow) g += `<line class="ch-min" x1="${L}" x2="${W - R}" y1="${y(T.mtow)}" y2="${y(T.mtow)}"/>`;
  if (to.arm != null && ld.arm != null) g += `<line class="wb-line" x1="${x(to.arm)}" y1="${y(to.mass)}" x2="${x(ld.arm)}" y2="${y(ld.mass)}"/>`;
  if (to.arm != null) g += `<circle class="wb-pt ${to.inEnv && !to.overMtow ? 'ok' : 'bad'}" cx="${x(to.arm)}" cy="${y(to.mass)}" r="8"/><text class="ch-label ch-strong" x="${x(to.arm) + 12}" y="${y(to.mass) - 8}">Start</text>`;
  if (ld.arm != null) g += `<circle class="wb-pt ld ${ld.inEnv && !ld.overMtow ? 'ok' : 'bad'}" cx="${x(ld.arm)}" cy="${y(ld.mass)}" r="7"/><text class="ch-label" x="${x(ld.arm) + 12}" y="${y(ld.mass) + 16}">Landung</text>`;
  g += `<text class="ch-label" x="${W - R}" y="${Hh - 6}" text-anchor="end">Hebelarm (${T.armUnit})</text><text class="ch-label" x="${L}" y="${Tp - 4}">Masse (${T.unit})</text>`;
  return `<svg class="chart wb-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Schwerpunkt-Hüllkurve">${g}</svg>`;
}

// ---------- Modul-Übersicht ----------
const MODULES = [
  { id: 'flug', n: 1, title: 'Flug', sub: 'Route, Flugzeug, Abflug, Flugplatz-Infos' },
  { id: 'wetter', n: 2, title: 'Wetter', sub: 'Ceiling, METAR/TAF zu deinen Zeiten, Öffnungszeiten, Tag/Nacht' },
  { id: 'notam', n: 3, title: 'NOTAM', sub: 'Korridor, Abfrage bei der DFS, Nachweis' },
  { id: 'fuel', n: 4, title: 'Kraftstoff', sub: 'Bedarf aus Strecke, Wind und Flugzeug' },
  { id: 'wb', n: 5, title: 'Masse & Schwerpunkt', sub: 'Weight & Balance mit Kraftstoff aus Modul 4' },
  { id: 'check', n: 6, title: 'Checkliste', sub: 'Ausweichplatz, Pisten, persönliche Fitness …' },
];
function moduleStatus(id) {
  const f = flightIn(), ids = flightIds(f), p = plan();
  if (id === 'flug') return ids.length >= 2 ? { ok: true, text: `${ids.join(' → ')} · ${p.acData.name}` } : { ok: false, text: 'Route fehlt' };
  if (!F || F.ids.join() !== ids.join()) return { ok: false, text: id === 'wetter' ? 'Wetter in Modul 1 laden' : 'zuerst Modul 1 abschließen' };
  B = F;
  const s = settings(), fp = flightPlan(depMs(p), p);
  if (id === 'wetter') {
    const all = F.airports.map((ap) => ({ ap, hours: ap.error ? null : computeHours(ap, F.start, s) }));
    const bad = all.filter(({ ap, hours }) => { const e = fp.eta[ap.id]; if (!e || !hours || ap.isAlt) return false; const v = evalAt(ap, hours, e.t, s); return statusCls(v) !== 'ok' || isOpen(ap, e.t) === false; });
    return bad.length ? { ok: false, warn: true, text: `${bad.length} Platz/Plätze nicht in Ordnung` } : { ok: true, text: `Abflug ${hhmm(fp.dep)}Z · alle Plätze über Minima` };
  }
  if (id === 'notam') { const n = store.get('notam', {}); return n.key === ids.join() && n.checkedAt ? { ok: true, text: `geprüft ${utc(n.checkedAt)}` } : { ok: false, text: 'noch nicht geprüft' }; }
  if (id === 'fuel') { const fc = fuelCalc(fp, p); return fc.ok == null ? { ok: false, text: `Bedarf ${Math.ceil(fc.required)} l – an Bord eintragen` } : fc.ok ? { ok: true, text: `${fc.onBoard} l an Bord ≥ ${Math.ceil(fc.required)} l Bedarf` } : { ok: false, warn: true, text: `zu wenig: ${fc.onBoard} l < ${Math.ceil(fc.required)} l` }; }
  if (id === 'wb') { const wb = wbCalc(p, fuelCalc(fp, p));
    if (wb.missing.length) return { ok: false, text: `fehlt: ${wb.missing.join(', ')}` };
    const good = !wb.to.overMtow && wb.to.inEnv && wb.ld.inEnv;
    return good ? { ok: !wb.emptyIsSample, warn: wb.emptyIsSample, text: `innerhalb der Grenzen${wb.emptyIsSample ? ' – mit Beispiel-Leermasse!' : ''}` } : { ok: false, warn: true, text: 'außerhalb der Grenzen' }; }
  if (id === 'check') { const c = checks(), n = CHECKS.filter(([k]) => c[k]).length; return { ok: n === CHECKS.length, text: `${n} von ${CHECKS.length} abgehakt` }; }
  return { ok: false, text: '' };
}
function overviewView() {
  return `<p class="meta">Arbeite die Module der Reihe nach ab. Am Ende erstellst du das gesamte Briefing als PDF.</p>
  <ul class="group modules">${MODULES.map((m) => { const st = moduleStatus(m.id);
    return `<li><a class="row mod" href="#prep/${m.id}"><span class="mod-n ${st.ok ? 'ok' : st.warn ? 'warn' : ''}">${st.ok ? '✓' : m.n}</span>
      <span class="mod-main"><b>${m.title}</b><span>${esc(st.text || m.sub)}</span></span><span class="chevron">›</span></a></li>`; }).join('')}</ul>
  <a class="btn-fill big" href="#prep/briefing">${SYM.share} Gesamtes Briefing erstellen</a>
  <p class="group-note">Keine amtliche Flugvorbereitung. Alle Angaben vor dem Flug mit den amtlichen Quellen (DWD, DFS, Flughandbuch) prüfen.</p>`;
}
const modNav = (id) => {
  const i = MODULES.findIndex((m) => m.id === id), prev = MODULES[i - 1], next = MODULES[i + 1];
  return `<div class="btn-row noprint">${prev ? `<a class="btn-tinted" href="#prep/${prev.id}">‹ ${prev.title}</a>` : '<a class="btn-tinted" href="#prep">‹ Übersicht</a>'}
    ${next ? `<a class="btn-fill" href="#prep/${next.id}">Weiter: ${next.title} ›</a>` : '<a class="btn-fill" href="#prep/briefing">Briefing erstellen ›</a>'}</div>`;
};
const needWeather = (n) => `<div class="empty">${ICONS.cloud}<h3>Noch keine Wetterdaten für diese Route</h3><p>In Modul 1 Route eingeben und „Wetter laden“ tippen.</p><a class="btn-fill" href="#prep/flug">Zu Modul 1</a></div>`;
const weatherReady = () => { const ids = flightIds(flightIn()); return F && F.ids.join() === ids.join(); };

// ---------- Modul 1: Flug ----------
const AIP_LINK = 'https://aip.dfs.de/basicVFR';
function apInfoHTML() {
  const f = flightIn();
  const ids = [...flightIds(f), ...(/^[A-Z0-9]{4}$/.test(f.alt) ? [f.alt] : [])];
  const hoursSel = (id) => { const i = apInfo(id);
    return `<select data-ah="${id}" data-k="mode">${[['unknown', 'nicht eingetragen'], ['times', 'Uhrzeit (UTC)'], ['srss', 'SR–SS (Tageslicht)'], ['h24', 'H24']].map(([v, t]) => `<option value="${v}"${i.mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`; };
  return ids.length ? ids.map((id) => { const i = apInfo(id);
    return `<div class="card apinfo" data-ap="${id}">
      <div class="ap-head"><div><h3>${esc(id)}</h3><div class="ap-name" data-name="${id}"></div></div>
        <a class="btn-tinted small" href="${AIP_LINK}" target="_blank" rel="noopener">AIP VFR öffnen ↗</a></div>
      <ul class="group inner">
        <li><label class="row"><span>Öffnungszeit</span>${hoursSel(id)}</label></li>
        ${i.mode === 'times' ? `<li><div class="row"><span>von / bis (UTC)</span><span class="inp"><input type="time" data-ah="${id}" data-k="open" value="${esc(i.open)}"> – <input type="time" data-ah="${id}" data-k="close" value="${esc(i.close)}"></span></div></li>` : ''}
        <li><label class="row"><span>PPR erforderlich</span><input type="checkbox" class="switch" data-ah="${id}" data-k="ppr"${i.ppr ? ' checked' : ''}></label></li>
        <li><label class="row col"><span>Notizen (Pisten, Frequenzen, Besonderheiten)</span><textarea data-ah="${id}" data-k="notes" rows="2" placeholder="z. B. Piste 08/26 Gras 800 m, Info 123,455">${esc(i.notes)}</textarea></label></li>
      </ul>
      <p class="detail">${i.checkedAt ? `Zuletzt geändert ${utc(i.checkedAt)}` : 'Noch nicht eingetragen.'} Öffnungszeiten können sich ändern – vor jedem Flug in der AIP und den NOTAM prüfen.</p>
      <p class="group-label tight">Flugplatzkarten</p>
      ${filesBox(`chart:${id}:`, true)}
      <label class="btn-tinted small upload">Karte hinzufügen (Foto, Screenshot, PDF)<input type="file" accept="image/*,application/pdf" multiple data-up="chart:${id}:" hidden></label>
    </div>`; }).join('') : '<p class="group-note">Erst Route eingeben.</p>';
}
function apInfoMount(W) {
  const box = $('apinfoBox'); if (!box) return;
  box.querySelectorAll('[data-ah]').forEach((el) => el.addEventListener('change', () => {
    setApInfo(el.dataset.ah, { [el.dataset.k]: el.type === 'checkbox' ? el.checked : el.value });
    if (el.dataset.k === 'mode') { box.innerHTML = apInfoHTML(); apInfoMount(W); }
  }));
  box.querySelectorAll('[data-up]').forEach((inp) => bindUpload(inp, inp.dataset.up, () => fillFiles(box)));
  if (W) box.querySelectorAll('[data-name]').forEach((el) => { const a = W.airports[el.dataset.name]; el.textContent = a ? a[0] + (a[3] != null ? ` · ${a[3]} ft` : '') : ''; });
  fillFiles(box);
}
function m1View() {
  const f = flightIn(), routes = store.get('routes', []), p = plan();
  const ids = [...flightIds(f), ...(/^[A-Z0-9]{4}$/.test(f.alt) ? [f.alt] : [])];
  const row = (key, label, val, k, removable) => `<li><div class="row route-row">
      <span class="rr-label">${label}</span>
      <input type="text" class="icao" maxlength="4" data-f="${key}"${k != null ? ` data-i="${k}"` : ''} value="${esc(val)}" placeholder="ICAO" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false">
      ${removable ? `<button class="btn-text danger-text" data-rm="${k}">Entfernen</button>` : ''}
    </div><div class="rr-info" data-info="${key}${k != null ? '-' + k : ''}"></div></li>`;
  const hoursSel = (id) => { const i = apInfo(id);
    return `<select data-ah="${id}" data-k="mode">${[['unknown', 'nicht eingetragen'], ['times', 'Uhrzeit (UTC)'], ['srss', 'SR–SS (Tageslicht)'], ['h24', 'H24']].map(([v, t]) => `<option value="${v}"${i.mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`; };
  return `
  ${routes.length ? `<p class="group-label">Gespeicherte Routen</p>
  <ul class="group">${routes.map((r, i) => `<li><div class="row"><button class="row-btn" data-r="${i}"><span>${esc(r.name)}</span><span class="detail">${esc(r.ids.join(' → '))}${r.alt ? ' · Ausweich ' + esc(r.alt) : ''}</span></button><button class="btn-text danger-text" data-rdel="${i}">Löschen</button></div></li>`).join('')}</ul>` : ''}
  <p class="group-label">Route</p>
  <ul class="group">
    ${row('from', 'Start', f.from)}
    ${f.via.map((v, k) => row('via', `Zwischenlandung ${f.via.length > 1 ? k + 1 : ''}`, v, k, true)).join('')}
    <li><button class="row center" id="addVia">＋ Zwischenlandung oder Wegpunkt-Platz hinzufügen</button></li>
    ${row('to', 'Ziel', f.to)}
  </ul>
  <p class="group-label">Ausweichplatz</p>
  <ul class="group">${row('alt', 'Ausweich', f.alt)}</ul>
  <div class="btn-row"><button class="btn-tinted" id="saveRoute">Route merken</button></div>

  ${planFormHTML(p)}
  <p class="group-label">NOTAM-Korridor</p>
  <ul class="group"><li><label class="row"><span>Breite beidseits der Route</span><span class="inp"><input type="number" inputmode="decimal" data-p="corridor" value="${p.corridor}" step="1" min="1"> NM</span></label></li></ul>
  <p class="group-note">Dieser Wert wird in Modul 3 für die NOTAM-Abfrage verwendet.</p>

  <p class="group-label">Flugplatz-Infos (AIP)</p>
  <div id="apinfoBox">${apInfoHTML()}</div>
  <p class="group-note">Die AIP VFR der DFS ist kostenlos, ein automatisches Auslesen ist laut Berichten nicht erlaubt. Darum: Seite öffnen, Werte hier eintragen, Karte als Screenshot hinzufügen. Die Angaben bleiben auf diesem Gerät gespeichert und gelten für alle Flüge.</p>

  <div class="btn-row"><button class="btn-fill" id="loadWx">Wetter laden & weiter ›</button></div>`;
}
function m1Mount() {
  const save = (f) => store.set('flight', f);
  const info = async () => {
    const W = await wdata(); const f = flightIn();
    const set = (key, id) => { const el = document.querySelector(`[data-info="${key}"]`); if (!el) return; const r = wxSource(W, (id || '').toUpperCase());
      el.innerHTML = r ? `<span class="${r.bad ? 'bad' : ''}">${r.name ? `<b>${esc(r.name)}</b> · ` : ''}${esc(r.text)}</span>` : ''; };
    set('from', f.from); set('to', f.to); set('alt', f.alt); f.via.forEach((v, k) => set('via-' + k, v));
    return W;
  };
  const refreshAp = async () => { const W = await wdata(); const box = $('apinfoBox'); if (box) { box.innerHTML = apInfoHTML(); apInfoMount(W); } };
  document.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const f = flightIn();
      if (el.dataset.f === 'via') f.via[+el.dataset.i] = el.value; else f[el.dataset.f] = el.value;
      save(f); if (el.value.length === 4 || el.value.length === 0) { info(); refreshAp(); }
    });
  });
  document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { const f = flightIn(); f.via.splice(+b.dataset.rm, 1); save(f); keepScroll(); }));
  $('addVia').addEventListener('click', () => { const f = flightIn(); if (f.via.length >= 6) return; f.via.push(''); save(f); keepScroll(); });
  document.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    const r = store.get('routes', [])[b.dataset.r]; if (!r) return;
    save({ from: r.ids[0] || '', via: r.ids.slice(1, -1), to: r.ids.length > 1 ? r.ids[r.ids.length - 1] : '', alt: r.alt || '' }); keepScroll();
  }));
  document.querySelectorAll('[data-rdel]').forEach((b) => b.addEventListener('click', () => {
    const routes = store.get('routes', []); const r = routes[b.dataset.rdel];
    if (r && confirm(`Route „${r.name}“ löschen?`)) { routes.splice(+b.dataset.rdel, 1); store.set('routes', routes); keepScroll(); }
  }));
  $('saveRoute').addEventListener('click', () => {
    const f = flightIn(), ids = flightIds(f);
    if (ids.length < 2) return alert('Bitte mindestens Start und Ziel eingeben.');
    const name = prompt('Name der Route', ids.join(' – ')); if (!name?.trim()) return;
    const routes = store.get('routes', []); routes.push({ name: name.trim(), ids, alt: /^[A-Z0-9]{4}$/.test(f.alt) ? f.alt : '' }); store.set('routes', routes); keepScroll();
  });
  planFormMount();
  $('loadWx').addEventListener('click', () => {
    const f = flightIn(), ids = flightIds(f), alt = /^[A-Z0-9]{4}$/.test(f.alt) ? f.alt : null;
    if (!/^[A-Z0-9]{4}$/.test(f.from) || !/^[A-Z0-9]{4}$/.test(f.to)) return alert('Bitte Start und Ziel als ICAO-Kennung eingeben (4 Zeichen).');
    const same = F && !F.demo && F.ids.join() === ids.join() && (F.altId || null) === alt && Date.now() - F.fetchedAt < 20 * 6e4;
    location.hash = '#prep/wetter';
    if (!same) loadFlight(ids, alt);
  });
  info().then((W) => apInfoMount(W));
}

// ---------- Modul 2: Wetter ----------
function m2View() {
  if (loading === 'flug') return `<div class="empty"><div class="spinner"></div><p>Lade METAR, TAF, Vorhersage und Streckenprofil …</p></div>`;
  if (!weatherReady()) return needWeather();
  const { s, p, all, ok, fp, win } = flightData();
  const pc = B.profile && fp.legs.length ? profileCheck(fp, { ...s, alt: p.alt }) : null;
  return `${routeLine()}${bannersHTML()}
  <h2 class="sec">Wetter entlang des Flugs</h2>
  ${alongHTML(all, fp, s, false)}
  ${windowsHTML(win, p, true)}
  ${B.profile && fp.legs.length ? profileCardHTML(fp, s, p, pc) : ''}
  <h2 class="sec">48 Stunden</h2>
  <div class="card">${ok.length ? timelineHTML(ok, fp) : ''}
    <div class="legend"><span><i class="cat-VFR"></i>VFR</span><span><i class="cat-MVFR"></i>MVFR</span><span><i class="cat-IFR"></i>IFR</span><span><i class="cat-LIFR"></i>LIFR</span>
    <span><i class="lg-below"></i>unter Minima</span><span><i class="lg-tempo2"></i>TEMPO unter Minima</span><span>● = deine Zeit am Platz</span></div>
  </div>
  <div class="card pick">
    <input type="range" id="slider" min="0" max="${SPAN - 1}" step="1" value="${sel}" aria-label="Stunde wählen">
    <div id="detail">${ok.length ? detailHTML(ok) : ''}</div>
  </div>
  <h2 class="sec">Plätze im Detail</h2>
  ${all.map(({ ap, hours }) => airportCard(ap, hours, s, fp)).join('')}
  ${modNav('wetter')}`;
}
function profileCardHTML(fp, s, p, pc) {
  return `<h2 class="sec">Strecke</h2>
  <section class="card ap">
    <div class="ap-head"><div><h3>Streckenprofil</h3><div class="ap-name">Wolkenbasis und Gelände zur geplanten Überflugzeit</div></div>
      ${pc ? `<span class="status ${pc.bad ? 'bad' : 'ok'}">${pc.gap === Infinity ? 'keine tiefen Wolken' : `min. ${Math.round(pc.gap / 100) * 100} ft über Grund`}</span>` : ''}</div>
    ${profileSVG(fp, s, p)}
    <div class="legend"><span><i class="lg-cloud"></i>Wolken (Modell)</span><span><i class="lg-terrain"></i>Gelände</span><span><i class="lg-taf"></i>Reiseflughöhe</span><span><i class="lg-below"></i>Abstand Wolken–Gelände unter Minimum</span></div>
    ${pc && pc.gap !== Infinity ? `<p class="sun">Engste Stelle: ${Math.round(pc.d)} NM nach Abflug, ca. ${hhmm(pc.t)}Z – Basis ${Math.round(pc.cb / 100) * 100} ft MSL, Gelände ${Math.round(pc.terr / 100) * 100} ft.${pc.inCloud ? ' <span class="bad">Reiseflughöhe liegt dort zu nah an oder über der Wolkenbasis.</span>' : ''}</p>` : ''}
    <p class="sun">Gelände entlang der direkten Linie (ohne Hindernisse), Wolkenbasis aus dem Modell – nur zur Orientierung.</p>
  </section>`;
}
function m2Mount() {
  $('reload')?.addEventListener('click', () => { if (B?.demo) { F = makeDemo(); route(); } else if (B) loadFlight(B.ids, B.altId); });
  if (!weatherReady() || loading) return;
  planFormMount();
  const s = settings();
  mountTimeControls(B.airports.filter((a) => !a.error).map((ap) => ({ ap, hours: computeHours(ap, B.start, s) })));
}

// ---------- Modul 3: NOTAM ----------
const NOTAM_LINK = 'https://secais.dfs.de';
function m3View() {
  const f = flightIn(), ids = flightIds(f), p = plan(), n = store.get('notam', {});
  if (ids.length < 2) return `<div class="empty"><h3>Noch keine Route</h3><p>Zuerst Modul 1 ausfüllen.</p><a class="btn-fill" href="#prep/flug">Zu Modul 1</a></div>`;
  const key = ids.join(), valid = n.key === key;
  const alt = /^[A-Z0-9]{4}$/.test(f.alt) ? f.alt : null;
  const fp = weatherReady() ? flightPlan(depMs(p), p) : null;
  const q = `${ids.join(' ')}${alt ? ' ' + alt : ''}`;
  return `
  <div class="card">
    <div class="wc-title">Abfrage für diesen Flug</div>
    <ul class="group inner">
      <li><div class="row"><span>Route</span><span class="detail">${esc(ids.join(' → '))}</span></div></li>
      ${alt ? `<li><div class="row"><span>Ausweichplatz</span><span class="detail">${esc(alt)}</span></div></li>` : ''}
      <li><div class="row"><span>Korridor</span><span class="detail">${p.corridor} NM beidseits der Route</span></div></li>
      <li><div class="row"><span>Zeitraum</span><span class="detail">${fp ? `${utc(fp.dep)} – ${hhmm(fp.altLeg ? fp.altLeg.arr : fp.end)}Z` : 'Abflugzeit in Modul 1/2 festlegen'}</span></div></li>
      <li><div class="row"><span>Plätze</span><span class="detail">${esc(q)}</span><button class="btn-text" id="copyQ">Kopieren</button></div></li>
    </ul>
    <div class="btn-row"><a class="btn-fill" href="${NOTAM_LINK}" target="_blank" rel="noopener">DFS AIS-Portal öffnen ↗</a></div>
    <p class="detail">Eine kostenlose, vollständige NOTAM-Schnittstelle für Deutschland gibt es nach meiner Recherche nicht. Deshalb fragst du die NOTAM im amtlichen DFS-Portal mit diesen Angaben ab (Streckenbriefing und Platz-NOTAM) und hängst das Ergebnis hier an.</p>
  </div>
  <p class="group-label">Ergebnis der Abfrage</p>
  <div class="card">
    ${filesBox('notam:' + key + ':', true)}
    <label class="btn-tinted small upload">NOTAM-Briefing hinzufügen (PDF, Screenshot)<input type="file" accept="image/*,application/pdf" multiple data-up="notam:${esc(key)}:" hidden></label>
    <label class="row col"><span>Relevante NOTAM / Notizen</span><textarea id="notamNotes" rows="4" placeholder="z. B. ED-R 123 aktiv 10–14Z, Kran 150 ft nahe EDQD">${esc(valid ? n.notes || '' : '')}</textarea></label>
  </div>
  <ul class="group gap"><li><label class="row check-row"><input type="checkbox" class="check" id="notamOk"${valid && n.checkedAt ? ' checked' : ''}><span>NOTAM für Route, Korridor und Zeitraum geprüft${valid && n.checkedAt ? ` <b>(${utc(n.checkedAt)})</b>` : ''}</span></label></li></ul>
  ${n.key && !valid ? '<p class="banner">Die gespeicherte Prüfung gehört zu einer anderen Route.</p>' : ''}
  ${modNav('notam')}`;
}
function m3Mount() {
  const ids = flightIds(flightIn()); if (ids.length < 2) return;
  const key = ids.join();
  document.querySelectorAll('[data-up]').forEach((inp) => bindUpload(inp, inp.dataset.up));
  fillFiles();
  $('copyQ')?.addEventListener('click', async () => { const t = document.querySelector('#copyQ').previousElementSibling.textContent; try { await navigator.clipboard.writeText(t); $('copyQ').textContent = 'Kopiert ✓'; } catch { prompt('Zum Kopieren markieren:', t); } });
  $('notamNotes').addEventListener('change', (e) => { const n = store.get('notam', {}); store.set('notam', { ...(n.key === key ? n : {}), key, notes: e.target.value }); });
  $('notamOk').addEventListener('change', (e) => { const n = store.get('notam', {}); store.set('notam', { ...(n.key === key ? n : {}), key, notes: $('notamNotes').value, checkedAt: e.target.checked ? Date.now() : null }); keepScroll(); });
}

// ---------- Modul 4: Kraftstoff ----------
function fuelTableHTML(fp, p, fc) {
  const r = (a, b, c = '') => `<tr><td>${a}</td><td class="num">${b}</td><td class="detail">${c}</td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl fuel">
    <tbody>
    ${r('Rollen', `${fp.taxi.toFixed(1)} l`, `${p.taxi} l je Start`)}
    ${r('Flug (Trip)', `${fp.trip.toFixed(1)} l`, `${fmtDur(fp.flight)} bei ${p.burn} l/h, inkl. Wind und Zuschlag`)}
    ${fc.withAlt && fp.altLeg ? r('Zum Ausweichplatz', `${fc.alt.toFixed(1)} l`, `${fmtDur(fp.altLeg.min)} nach ${esc(fp.altLeg.to)}`) : ''}
    ${fc.extraMin ? r('Zusatz', `${fc.extra.toFixed(1)} l`, `${fc.extraMin} min`) : ''}
    ${r('Endreserve', `${fp.reserve.toFixed(1)} l`, `${p.reserve} min`)}
    <tr class="sum"><td><b>Mindestens an Bord</b></td><td class="num"><b>${Math.ceil(fc.required)} l</b></td><td></td></tr>
    </tbody></table></div>`;
}
function m4View() {
  if (!weatherReady()) return needWeather();
  B = F;
  const p = plan(), fp = flightPlan(depMs(p), p), fc = fuelCalc(fp, p), T = wbType(p.ac);
  return `${routeLine()}
  <p class="group-label">Bedarf · ${esc(p.acData.name)} · ${p.burn} l/h · ${esc(p.acData.fuel)}</p>
  <div class="card">${fuelTableHTML(fp, p, fc)}</div>
  <ul class="group gap">
    <li><label class="row"><span>Ausweichplatz einrechnen</span><input type="checkbox" class="switch" data-fu="withAlt"${fc.withAlt ? ' checked' : ''}${fp.altLeg ? '' : ' disabled'}></label></li>
    <li><label class="row"><span>Zusätzliche Reserve</span><span class="inp"><input type="number" inputmode="decimal" data-fu="extraMin" value="${fc.extraMin}" step="5" min="0"> min</span></label></li>
    <li><label class="row"><span>Kraftstoff an Bord vor dem Anlassen</span><span class="inp"><input type="number" inputmode="decimal" data-fu="onBoard" value="${fc.onBoard ?? ''}" step="1" min="0" placeholder="?"> l</span></label></li>
  </ul>
  <p class="group-note">Endreserve VFR am Tag üblicherweise 30 min (nachts 45 min) – Wert in Modul 1 anpassbar. Zeiten und Verbrauch kommen aus Modul 1, Gegen- oder Rückenwind aus der Höhenwind-Vorhersage (Modul 2). Ausweich-Kraftstoff ist für VFR nicht vorgeschrieben, aber empfehlenswert.</p>
  ${fc.onBoard != null ? `<div class="card wincard ${fc.ok ? 'ok' : 'bad'}"><span class="wc-icon">${fc.ok ? SYM.ok : SYM.warn}</span>
    <div><div class="wc-title">${fc.ok ? 'Kraftstoff reicht' : 'Zu wenig Kraftstoff'}</div>
    <div class="wc-sub">${fc.onBoard} l an Bord · Bedarf ${Math.ceil(fc.required)} l · Flugdauer möglich ca. ${fmtDur(Math.max(0, fc.endurance))} · Landung mit ca. ${fc.landing.toFixed(0)} l</div></div></div>` : ''}
  ${T.usableFuel ? '' : '<p class="group-note">Ausfliegbare Tankkapazität kannst du in Modul 5 beim Flugzeug hinterlegen.</p>'}
  ${modNav('fuel')}`;
}
function m4Mount() {
  document.querySelectorAll('[data-fu]').forEach((el) => el.addEventListener('change', () => {
    const f = fuelIn(); const k = el.dataset.fu;
    f[k] = el.type === 'checkbox' ? el.checked : el.value === '' ? null : Math.max(0, parseFloat(el.value) || 0);
    store.set('fuel', f); keepScroll();
  }));
}

// ---------- Modul 5: Masse & Schwerpunkt ----------
let wbEdit = false;
function wbTableHTML(wb) {
  const { T } = wb, u = T.unit, au = T.armUnit;
  const f = (v, d = 1) => (v == null ? '–' : (+v).toFixed(d));
  const kgCol = (m) => (u === 'lb' && m != null ? ` <span class="detail">(${(m / LB).toFixed(0)} kg)</span>` : '');
  const rows = wb.items.map((it) => `<tr><td>${esc(it.name)}${it.sample ? ' <span class="pill warn-pill">Beispiel</span>' : ''}</td><td class="num">${f(it.mass)} ${u}${kgCol(it.mass)}</td><td class="num">${f(it.arm, 2)}</td><td class="num">${it.mass && it.arm != null ? f(it.mass * it.arm, 0) : '–'}</td></tr>`).join('');
  const fuelRow = (lab, m) => `<tr><td>${lab}</td><td class="num">${f(m)} ${u}${kgCol(m)}</td><td class="num">${f(T.fuelArm, 2)}</td><td class="num">${m && T.fuelArm != null ? f(m * T.fuelArm, 0) : '–'}</td></tr>`;
  const res = (lab, r) => `<tr class="sum"><td><b>${lab}</b></td><td class="num"><b>${f(r.mass)} ${u}</b>${kgCol(r.mass)}${r.overMtow ? ' <span class="bad">> MTOW</span>' : ''}</td><td class="num"><b>${f(r.arm, 2)}</b></td><td class="num">${r.inEnv == null ? '–' : r.inEnv ? '<span class="ok-text">innerhalb</span>' : '<span class="bad">außerhalb</span>'}</td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl wb"><thead><tr><th>Posten</th><th>Masse</th><th>Hebelarm (${au})</th><th>Moment</th></tr></thead><tbody>
    ${rows}${fuelRow('Kraftstoff beim Start', wb.fuelTo)}${res('Startmasse', wb.to)}${fuelRow('Kraftstoff bei Landung', wb.fuelLd)}${res('Landemasse', wb.ld)}
  </tbody></table></div>`;
}
function m5View() {
  if (!weatherReady()) return needWeather();
  B = F;
  const p = plan(), fp = flightPlan(depMs(p), p), fc = fuelCalc(fp, p), wb = wbCalc(p, fc), { T, W } = wb;
  const kgIn = (k, label, val) => `<li><label class="row"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" data-wb="${k}" value="${val ?? ''}" step="1" min="0"> kg</span></label></li>`;
  const typeEdit = wbEdit ? `
    <ul class="group inner">
      <li><label class="row"><span>Höchstabflugmasse (MTOW)</span><span class="inp"><input type="number" step="any" data-wt="mtow" value="${T.mtow ?? ''}"> ${T.unit}</span></label></li>
      <li><label class="row"><span>Hebelarm Kraftstoff</span><span class="inp"><input type="number" step="any" data-wt="fuelArm" value="${T.fuelArm ?? ''}"> ${T.armUnit}</span></label></li>
      <li><label class="row"><span>Kraftstoffdichte</span><span class="inp"><input type="number" step="0.01" data-wt="fuelDensity" value="${T.fuelDensity ?? ''}"> kg/l</span></label></li>
      <li><label class="row"><span>Ausfliegbarer Kraftstoff</span><span class="inp"><input type="number" step="any" data-wt="usableFuel" value="${T.usableFuel ?? ''}"> l</span></label></li>
      ${T.stations.map((s) => `<li><label class="row"><span>Hebelarm ${esc(s.name)}</span><span class="inp"><input type="number" step="any" data-wa="${s.k}" value="${s.arm ?? ''}"> ${T.armUnit}</span></label></li>`).join('')}
      <li><label class="row col"><span>Schwerpunkt-Hüllkurve: je Zeile „Masse; Hebelarm“ (${T.unit}; ${T.armUnit}), Eckpunkte der Reihe nach</span>
        <textarea id="envText" rows="6" placeholder="1950; 35.0">${T.env.map(([m, a]) => `${m}; ${a}`).join('\n')}</textarea></label></li>
    </ul>
    <div class="btn-row"><button class="btn-tinted" id="wbReset">Typwerte wiederherstellen</button><button class="btn-fill" id="wbSave">Speichern</button></div>` : `
    <ul class="group inner">
      <li><div class="row"><span>MTOW</span><span class="detail">${T.mtow ?? '–'} ${T.unit}</span></div></li>
      <li><div class="row"><span>Hebelarm Kraftstoff</span><span class="detail">${T.fuelArm ?? '<span class="bad">fehlt</span>'} ${T.fuelArm != null ? T.armUnit : ''}</span></div></li>
      ${T.stations.map((s) => `<li><div class="row"><span>Hebelarm ${esc(s.name)}</span><span class="detail">${s.arm ?? '<span class="bad">fehlt</span>'} ${s.arm != null ? T.armUnit : ''}</span></div></li>`).join('')}
      <li><div class="row"><span>Hüllkurve</span><span class="detail">${T.env.length >= 3 ? `${T.env.length} Eckpunkte` : '<span class="bad">fehlt</span>'}</span></div></li>
    </ul>
    <div class="btn-row"><button class="btn-tinted" id="wbEditBtn">Typwerte bearbeiten</button></div>`;
  return `
  <p class="group-label">Flugzeug · ${esc(p.acData.name)}${T.edited ? ' · bearbeitet' : ''}</p>
  <div class="card">
    ${typeEdit}
    <p class="detail"><b>Quellen:</b> ${T.src.map(esc).join(' · ')}</p>
    <p class="detail">${esc(T.notes)}</p>
  </div>
  <p class="group-label">Leermasse deines Flugzeugs (Wägebericht)</p>
  <ul class="group">
    <li><label class="row"><span>Leermasse</span><span class="inp"><input type="number" step="any" data-wb="emptyMass" value="${W.emptyMass ?? ''}" placeholder="${T.sample?.mass ?? ''}"> ${T.unit}</span></label></li>
    <li><label class="row"><span>Hebelarm Leermasse</span><span class="inp"><input type="number" step="any" data-wb="emptyArm" value="${W.emptyArm ?? ''}" placeholder="${T.sample?.arm ?? ''}"> ${T.armUnit}</span></label></li>
  </ul>
  ${wb.emptyIsSample ? `<p class="banner">Ohne eigene Werte rechnet die App mit einem Beispiel: ${esc(T.sample ? `${T.sample.mass ?? '–'} ${T.unit} / ${T.sample.arm ?? '–'} ${T.armUnit} – ${T.sample.src}` : 'keins vorhanden')}. Jedes Flugzeug ist anders – trage die Werte aus deinem Wägebericht ein.</p>` : ''}
  <p class="group-label">Zuladung</p>
  <ul class="group">
    ${T.stations.map((s) => kgIn(s.k, esc(s.name), W[s.k])).join('')}
    <li><div class="row"><span>Kraftstoff (aus Modul 4)</span><span class="detail">${fc.takeoff != null ? `${fc.takeoff.toFixed(0)} l beim Start · ${fc.landing.toFixed(0)} l bei Landung · Dichte ${T.fuelDensity} kg/l` : '<a href="#prep/fuel">in Modul 4 eintragen</a>'}</span></div></li>
  </ul>
  <p class="group-note">Personen und Gepäck in kg${T.unit === 'lb' ? ' – die App rechnet in lb um (1 kg = 2,20462 lb)' : ''}.</p>
  <h2 class="sec">Ergebnis</h2>
  ${wb.missing.length ? `<p class="banner">Für eine vollständige Rechnung fehlt noch: ${esc(wb.missing.join(', '))}.</p>` : ''}
  <div class="card">${wbTableHTML(wb)}${envelopeSVG(wb)}</div>
  ${modNav('wb')}`;
}
function m5Mount() {
  if (!weatherReady()) return;
  const ac = plan().ac;
  document.querySelectorAll('[data-wb]').forEach((el) => el.addEventListener('change', () => { setWbFlight({ [el.dataset.wb]: el.value === '' ? null : parseFloat(el.value) }); keepScroll(); }));
  $('wbEditBtn')?.addEventListener('click', () => { wbEdit = true; keepScroll(); });
  $('wbReset')?.addEventListener('click', () => { if (!confirm('Eigene Typwerte verwerfen und Quellwerte wiederherstellen?')) return; const all = store.get('wbTypes', {}); delete all[ac]; store.set('wbTypes', all); wbEdit = false; keepScroll(); });
  $('wbSave')?.addEventListener('click', () => {
    const all = store.get('wbTypes', {}), o = all[ac] || {};
    document.querySelectorAll('[data-wt]').forEach((el) => { o[el.dataset.wt] = el.value === '' ? null : parseFloat(el.value); });
    o.arms = o.arms || {};
    document.querySelectorAll('[data-wa]').forEach((el) => { o.arms[el.dataset.wa] = el.value === '' ? null : parseFloat(el.value); });
    const env = $('envText').value.split('\n').map((l) => l.split(/[;\t]+|\s{2,}/).map((x) => parseFloat(x.replace(',', '.')))).filter((x) => x.length >= 2 && !isNaN(x[0]) && !isNaN(x[1])).map((x) => [x[0], x[1]]);
    o.env = env;
    all[ac] = o; store.set('wbTypes', all); wbEdit = false; keepScroll();
  });
}

// ---------- Modul 6: Checkliste ----------
function m6View() {
  const f = flightIn();
  const p = plan();
  const fp = weatherReady() ? (B = F, flightPlan(depMs(p), p)) : null;
  return `${f.alt ? `<p class="meta">Ausweichplatz: <b>${esc(f.alt)}</b>${fp?.altLeg ? ` · ${Math.round(fp.altLeg.dist)} NM ab Ziel, ${fmtDur(fp.altLeg.min)}` : ''}</p>` : '<p class="banner">Kein Ausweichplatz festgelegt – in Modul 1 eintragen.</p>'}
  ${CHECKS_HTML(fp)}
  ${modNav('check')}`;
}
function m6Mount() {
  document.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => { const c = checks(); c[el.dataset.c] = el.checked; store.set('checks', c); }));
  $('ckReset')?.addEventListener('click', () => { store.set('checks', {}); keepScroll(); });
}

// ---------- Gesamtes Briefing ----------
function briefingAllView() {
  if (loading === 'flug') return `<div class="empty"><div class="spinner"></div><p>Lade Wetter …</p></div>`;
  if (!weatherReady()) return needWeather();
  const { s, p, all, ok, fp, win } = flightData();
  const f = flightIn(), n = store.get('notam', {}), notamOk = n.key === flightIds(f).join() && n.checkedAt;
  const fc = fuelCalc(fp, p), wb = wbCalc(p, fc);
  const pc = B.profile && fp.legs.length ? profileCheck(fp, { ...s, alt: p.alt }) : null;
  const routeTxt = B.ids.join(' → ') + (B.altId ? ` (Ausweich ${B.altId})` : '');
  const status = MODULES.map((m) => ({ m, st: moduleStatus(m.id) }));
  const apIds = [...B.ids, ...(B.altId ? [B.altId] : [])];
  return `
  <div class="print-only print-head">
    <h1>FlightPrep – Flugvorbereitung</h1>
    <p><b>${esc(routeTxt)}</b> · ${esc(p.acData.name)} · TAS ${p.tas} kt · ${p.burn} l/h · ${p.alt} ft</p>
    <p>Export: <span id="exportTime"></span> · Wetter abgerufen: ${utc(B.fetchedAt)}${B.dataAt ? ` (METAR/TAF-Stand ${hhmm(B.dataAt)}Z)` : ''} · Minima: ${s.minCeil} ft / ${s.minVis} km / Wind ${s.maxWind} kt, Böen ${s.maxGust} kt</p>
  </div>
  <div class="noprint">${routeLine()}</div>${bannersHTML()}
  <h2 class="sec">Übersicht</h2>
  <ul class="group modules">${status.map(({ m, st }) => `<li><div class="row mod"><span class="mod-n ${st.ok ? 'ok' : st.warn ? 'warn' : ''}">${st.ok ? '✓' : m.n}</span><span class="mod-main"><b>${m.title}</b><span>${esc(st.text)}</span></span></div></li>`).join('')}</ul>

  <h2 class="sec">1 · Flug</h2>
  <div class="card plancard"><span class="wc-icon">${ICONS.plane}</span>
    <div class="pc-main"><div class="wc-title">${esc(p.acData.name)} · Abflug ${dayLabel(fp.dep)} ${hhmm(fp.dep)}Z · Ankunft ${hhmm(fp.end)}Z</div>
    <div class="wc-sub">${Math.round(fp.dist)} NM · ${fmtDur(fp.flight)} · Reiseflughöhe ${p.alt} ft</div></div></div>
  <div class="card">${planDetailsHTML(fp, p)}</div>
  ${apIds.map((id) => { const i = apInfo(id); return `<div class="card apbrief"><div class="ap-head"><div><h3>${esc(id)}</h3><div class="ap-name">${esc(B.airports.find((a) => a.id === id)?.name || '')}</div></div></div>
    <p>Öffnungszeit: <b>${esc(hoursText(id))}</b> · PPR: <b>${i.ppr ? 'ja' : 'nein'}</b>${i.checkedAt ? ` · eingetragen ${utc(i.checkedAt)}` : ' · <span class="bad">nicht eingetragen</span>'}</p>
    ${i.notes ? `<p>${esc(i.notes)}</p>` : ''}${filesBox(`chart:${id}:`, false)}</div>`; }).join('')}

  <h2 class="sec">2 · Wetter</h2>
  ${alongHTML(all, fp, s, false)}
  ${windowsHTML(win, p, false)}
  ${B.profile && fp.legs.length ? profileCardHTML(fp, s, p, pc) : ''}
  <div class="card">${ok.length ? timelineHTML(ok, fp) : ''}</div>
  ${all.map(({ ap, hours }) => airportCard(ap, hours, s, fp)).join('')}

  <h2 class="sec">3 · NOTAM</h2>
  <div class="card"><p>${notamOk ? `Geprüft am <b>${utc(n.checkedAt)}</b> · Korridor ${p.corridor} NM` : '<span class="bad">Nicht als geprüft markiert.</span>'}</p>
    ${n.key === flightIds(f).join() && n.notes ? `<p>${esc(n.notes)}</p>` : ''}${filesBox('notam:' + flightIds(f).join() + ':', false)}</div>

  <h2 class="sec">4 · Kraftstoff</h2>
  <div class="card">${fuelTableHTML(fp, p, fc)}<p>${fc.onBoard != null ? `An Bord: <b>${fc.onBoard} l</b> – ${fc.ok ? 'ausreichend' : '<span class="bad">nicht ausreichend</span>'}` : '<span class="bad">Kraftstoff an Bord nicht eingetragen.</span>'}</p></div>

  <h2 class="sec">5 · Masse & Schwerpunkt</h2>
  <div class="card">${wb.missing.length ? `<p class="bad">Unvollständig: ${esc(wb.missing.join(', '))}</p>` : ''}${wb.emptyIsSample ? '<p class="bad">Gerechnet mit Beispiel-Leermasse, nicht mit dem Wägebericht dieses Flugzeugs.</p>' : ''}${wbTableHTML(wb)}${envelopeSVG(wb)}
    <p class="detail">Quellen Typdaten: ${wb.T.src.map(esc).join(' · ')}${wb.T.edited ? ' · vom Nutzer bearbeitet' : ''}</p></div>

  <h2 class="sec">6 · Checkliste</h2>
  ${CHECKS_HTML(fp)}

  <button class="btn-fill big noprint" id="pdfBig">${SYM.share} Briefing als PDF sichern</button>
  <p class="foot">Quellen: METAR/TAF aviationweather.gov (NOAA), Flugplätze OurAirports, Modell und Gelände Open-Meteo (u. a. DWD ICON); Flugplatz-Infos, Karten und NOTAM vom Nutzer aus AIP VFR und DFS AIS-Portal übernommen. Keine amtliche Flugwetterberatung oder Flugvorbereitung – vor dem Flug amtliche Quellen und Flughandbuch prüfen.</p>`;
}
function briefingAllMount() {
  $('pdfBig')?.addEventListener('click', exportPDF);
  $('pdf')?.addEventListener('click', exportPDF);
  $('reload')?.addEventListener('click', () => { if (B?.demo) { F = makeDemo(); route(); } else if (B) loadFlight(B.ids, B.altId); });
  document.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => { const c = checks(); c[el.dataset.c] = el.checked; store.set('checks', c); }));
  $('ckReset')?.addEventListener('click', () => { store.set('checks', {}); keepScroll(); });
  fillFiles();
  if (!weatherReady() || loading) return;
}

const PREP = {
  '': { title: 'FlightPrep', view: overviewView },
  flug: { title: '1 · Flug', view: m1View, mount: m1Mount },
  wetter: { title: '2 · Wetter', view: m2View, mount: m2Mount, actions: () => weatherReady() && !loading ? BTN('reload', 'Aktualisieren', SYM.reload) : '' },
  notam: { title: '3 · NOTAM', view: m3View, mount: m3Mount },
  fuel: { title: '4 · Kraftstoff', view: m4View, mount: m4Mount },
  wb: { title: '5 · Masse & Schwerpunkt', view: m5View, mount: m5Mount },
  check: { title: '6 · Checkliste', view: m6View, mount: m6Mount },
  briefing: { title: 'Briefing', view: briefingAllView, mount: briefingAllMount, actions: () => weatherReady() && !loading ? BTN('reload', 'Aktualisieren', SYM.reload) + BTN('pdf', 'Als PDF sichern', SYM.share) : '' },
};

// ---------- Bereiche = Menüpunkte ----------
const BTN = (id, label, sym) => `<button class="btn-text sym" id="${id}" aria-label="${label}" title="${label}">${sym}</button>`;
const SECTIONS = [
  {
    id: 'prep', title: 'FlightPrep', icon: ICONS.plane, data: () => F,
    actions: (sub) => (PREP[sub || ''] || PREP['']).actions?.() || '',
    render: (sub) => (PREP[sub || ''] || PREP['']).view(),
    mount: (sub) => (PREP[sub || ''] || PREP['']).mount?.(),
  },
  {
    id: 'wetter', title: 'Wetter', icon: ICONS.cloud, data: () => V,
    actions: () => V && !loading ? BTN('reload', 'Aktualisieren', SYM.reload) : '',
    render: wetterView, mount: wetterMount,
  },
  {
    id: 'einstellungen', title: 'Einstellungen', icon: ICONS.gear, data: () => F,
    render: () => {
      const s = settings(), coords = store.get('coords', {});
      const num = (k, label, unit, step) => `<li><label class="row"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" data-k="${k}" value="${s[k]}" step="${step}" min="0"> ${unit}</span></label></li>`;
      return `
      <p class="group-label">Persönliche Minima</p>
      <ul class="group">${num('minCeil', 'Wolkenuntergrenze', 'ft', 100)}${num('minVis', 'Sicht', 'km', 0.5)}${num('maxWind', 'Wind max.', 'kt', 1)}${num('maxGust', 'Böen max.', 'kt', 1)}</ul>
      <p class="group-note">Zeiten unter diesen Werten werden rot markiert und zählen nicht als mögliche Abflugzeit.</p>

      <p class="group-label">Eigene Flugplätze</p>
      <ul class="group">${Object.entries(coords).map(([id, c]) => `<li><div class="row"><span>${esc(id)} <span class="detail">${esc(c.name || '')} ${(+c.lat).toFixed(3)}, ${(+c.lon).toFixed(3)}</span></span><button class="btn-text danger-text" data-del="${esc(id)}">Löschen</button></div></li>`).join('')}
      <li><button class="row" id="addc">Platz mit Koordinaten hinzufügen …</button></li></ul>
      <p class="group-note">Nur nötig, wenn ein kleiner Platz nicht gefunden wird (z. B. Ultraleicht- oder Segelfluggelände).</p>

      <p class="group-label">Ausprobieren</p>
      <ul class="group"><li><button class="row" id="demo">Beispielflug anzeigen</button></li></ul>

      <p class="group-label">Daten</p>
      <ul class="group"><li><button class="row danger" id="reset">Alle Daten löschen</button></li></ul>
      <p class="group-note">Routen, Minima, Flugzeugwerte und das letzte Briefing werden nur auf diesem Gerät gespeichert.<br>
      Quellen: aviationweather.gov (METAR, TAF), OurAirports (Flugplätze), Open-Meteo (Modell, Gelände). METAR/TAF werden etwa alle 15–60 Minuten aktualisiert. Keine amtliche Flugwetterberatung.</p>`;
    },
    mount: () => {
      document.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
        const s = store.get('settings', {});
        s[inp.dataset.k] = inp.type === 'number' ? Math.max(0, parseFloat(inp.value) || 0) : inp.value.trim();
        store.set('settings', s);
      }));
      document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        if (!confirm(`${b.dataset.del} löschen?`)) return;
        const c = store.get('coords', {}); delete c[b.dataset.del]; store.set('coords', c); route();
      }));
      $('addc').addEventListener('click', () => {
        const v = prompt('ICAO, Breite, Länge, Name\nz. B.: EDXY 49.123 8.456 Musterhausen');
        if (!v) return;
        const [id, lat, lon, ...name] = v.trim().split(/[\s,;]+/);
        if (!/^[A-Z0-9]{4}$/i.test(id) || isNaN(+lat) || isNaN(+lon)) return alert('Bitte im Format „EDXY 49.123 8.456 Name" eingeben.');
        const c = store.get('coords', {}); c[id.toUpperCase()] = { lat: +lat, lon: +lon, name: name.join(' ') }; store.set('coords', c); route();
      });
      $('demo').addEventListener('click', () => { useDemo(); location.hash = '#prep/briefing'; });
      $('reset').addEventListener('click', () => {
        if (confirm('Alle Daten löschen? Das lässt sich nicht rückgängig machen.')) { localStorage.clear(); F = null; V = null; route(); }
      });
    },
  },
];
function useDemo() {
  F = makeDemo(); sel = 0;
  store.set('flight', { from: 'EDFE', via: ['EDFW'], to: 'EDQD', alt: '' });
  V = { ...F, ids: ['EDFE'], airports: [F.airports[0]], profile: null, altId: null };
}

// ---------- Navigation ----------
const $ = (id) => document.getElementById(id);
$('nav').innerHTML = SECTIONS.map((s) =>
  `<li><a href="#${s.id}" data-id="${s.id}">${s.icon}<span>${s.title}</span></a></li>`).join('');

function route() {
  let [id, sub] = location.hash.slice(1).split('/');
  // alte Adressen weiterleiten
  if (id === 'briefing') { location.replace('#prep/briefing'); return; }
  if (id === 'routen') { location.replace('#prep/flug'); return; }
  if (id === 'flug') { location.replace(['', '#prep/flug', '#prep/wetter', '#prep/briefing'][+sub || 1] || '#prep/flug'); return; }
  const section = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  B = section.data();
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.id === section.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const title = section.id === 'prep' ? (PREP[sub || ''] || PREP['']).title : section.title;
  $('back').hidden = !(section.id === 'prep' && sub);
  $('back').onclick = () => { location.hash = '#prep'; };
  $('largeTitle').textContent = title;
  $('barTitle').textContent = title;
  $('barActions').innerHTML = section.actions?.(sub) || '';
  $('view').innerHTML = section.render(sub);
  $('view').dataset.section = section.id;
  $('scroll').scrollTop = 0;
  document.title = `${title} – FlightPrep`;
  section.mount?.(sub);
}

// Großer Titel wird beim Scrollen zum kleinen Titel in der Leiste
$('scroll').addEventListener('scroll', () => {
  document.querySelector('.bar').classList.toggle('scrolled', $('scroll').scrollTop > 40);
}, { passive: true });

// Alte Eingaben übernehmen (vor dem Umbau gab es nur eine Liste von Plätzen)
if (!store.get('flight', null) && store.get('currentIds', null)) {
  const ids = store.get('currentIds', []);
  store.set('flight', { from: ids[0] || '', via: ids.slice(1, -1), to: ids.length > 1 ? ids[ids.length - 1] : '', alt: '' });
}
addEventListener('hashchange', route);
if (F) sel = Math.max(0, Math.min(SPAN - 1, Math.floor((Date.now() - F.start) / H)));
if (new URLSearchParams(location.search).has('demo')) useDemo();
route();

// ---------- Offline-Fähigkeit ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}

