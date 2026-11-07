// =====================================================================
// Ceiling – Wolkenuntergrenze über 48 h für Flugplätze und Routen
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
const PLAN_DEFAULTS = { ac: 'C172', alt: 3500, depDay: 0, depTime: '', allow: 8, stop: 0, reserve: 30, taxi: 3, useWind: true, custom: {} };
const plan = () => {
  const p = { ...PLAN_DEFAULTS, ...store.get('plan', {}) };
  const a = AIRCRAFT[p.ac] || AIRCRAFT.C172, c = (p.custom || {})[p.ac] || {};
  return { ...p, custom: p.custom || {}, acData: a, tas: c.tas ?? a.tas, burn: c.burn ?? a.burn };
};

let B = store.get('briefing', null); // letztes Briefing (bleibt auch offline sichtbar)
let loading = false;
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
    base = ch === 'BECMG' ? merge(base, f) : norm(f);
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
    const taf = ap.taf && ap.tafUse ? tafAt(ap.taf, tm) : null;
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
    else if (taf?.tempo && ((taf.tempo.ceil ?? Infinity) < s.minCeil || (taf.tempo.vis ?? 10) < s.minVis)) h.status = 'tempo';
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

async function loadBriefing(ids) {
  if (!ids.length) return;
  store.set('currentIds', ids);
  loading = true; route();
  const errors = [];
  const W = await loadData();
  if (!W.status) errors.push('METAR/TAF nicht erreichbar (offline?) – es wird nur das Modell genutzt.');
  else if (W.status.errors?.length) errors.push('Wetterquelle: ' + W.status.errors.join(' · '));
  const coords = store.get('coords', {});

  const airports = await Promise.all(ids.map(async (id) => {
    const m = W.metar.find((x) => x.icaoId === id), t = W.taf.find((x) => x.icaoId === id);
    const a = W.airports[id], c = coords[id];
    const src = c || (a && { lat: a[1], lon: a[2] }) || m || t;
    if (!src || src.lat == null) return { id, name: id, error: 'Platz nicht in der Datenbank. Koordinaten in den Einstellungen eintragen.' };
    const ap = { id, name: c?.name || a?.[0] || id, lat: +src.lat, lon: +src.lon, elevFt: a?.[3] ?? null, metar: m || null, taf: t || null, tafUse: !!t, notes: [] };

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
    // Modell für genau diesen Ort
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
  const valid = airports.filter((a) => !a.error);
  let profile = null;
  if (valid.length > 1) profile = await loadProfile(valid, start).catch((e) => { errors.push('Streckenprofil: ' + e.message); return null; });
  B = { fetchedAt: Date.now(), dataAt: W.status?.fetchedAt ? W.status.fetchedAt * 1000 : null, start, ids, airports, errors, demo: false, profile };
  store.set('briefing', B);
  loading = false; sel = 0;
  if (location.hash.startsWith('#briefing') || !location.hash) route(); else location.hash = '#briefing';
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
  g += step((h) => h.taf?.tempo?.ceil, 'ch-tempo');
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
    if (typeof w.wdir === 'number' && w.wspd >= 1) g += `<g transform="translate(${cx},${wY - 6}) rotate(${w.wdir + 180})"><path class="ch-arrow${bad ? ' bad' : ''}" d="M0,-7L0,7M-4.5,2.5L0,7L4.5,2.5"/></g>`;
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
    const cat = m || h0.cat ? category(ceil, vis) : null, src = m ? (ap.metarSrc ? `METAR ${ap.metarSrc.id} (${ap.metarSrc.dist} km)` : 'METAR') : h0.src || 'keine Daten';
    const good = h0.status === 'ok';
    const nx = hours.find((h) => h.i > ni && (h.status === 'ok') !== good);
    const when = nx ? `${WD[new Date(nx.t).getUTCDay()]} ${p2(new Date(nx.t).getUTCHours())}Z` : '';
    const why = !good && h0.why?.length ? ` (${h0.why.join(', ')})` : !good && h0.status === 'tempo' ? ' (TEMPO)' : '';
    const nd = hours.find((h) => h.i > ni && h.status !== 'none');
    const trend = h0.status === 'none' ? (nd ? `Vorhersage ab ${WD[new Date(nd.t).getUTCDay()]} ${p2(new Date(nd.t).getUTCHours())}Z` : 'Keine Vorhersage')
      : good ? (nx ? `Über Minima bis ${when}` : 'Über Minima für 48 h') : (nx ? `Unter Minima${why} bis ${when}` : `Unter Minima${why} für 48 h`);
    const big = ceil == null ? '–' : ceil === Infinity ? 'frei' : Math.round(ceil / 100) * 100;
    return `<button class="tile" data-go="${esc(ap.id)}">
      <div class="t-top"><span class="t-id">${esc(ap.id)}</span>${cat ? `<span class="pill cat-${cat}">${cat}</span>` : ''}</div>
      <div class="t-name">${esc(ap.name)}</div>
      <div class="t-big">${big}${typeof big === 'number' ? '<small> ft</small>' : ''}</div>
      <div class="t-sub">Ceiling jetzt · ${src}</div>
      <div class="t-meta">${fmtWind(m || h0.wind)} · ${fmtVis(vis)}</div>
      <div class="t-trend ${h0.status === 'none' ? 'none' : good ? 'ok' : 'bad'}"><i></i>${trend}</div>
      ${(() => { const e = fp?.eta[ap.id]; if (!e) return ''; const i = hourOf(e.t); const h = i == null ? null : hours[i];
        const st = !h ? 'außerhalb 48 h' : h.status === 'none' ? 'keine Daten' : h.status === 'ok' ? (h.day ? 'über Minima' : 'Nacht') : h.status === 'tempo' ? 'TEMPO unter Minima' : 'unter Minima';
        return `<div class="t-eta ${h && h.status === 'ok' && h.day ? 'ok' : 'bad'}">${e.kind} ${hhmm(e.t)}Z · ${st}</div>`; })()}
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
      <div><h3>${esc(ap.id)}</h3><div class="ap-name">${esc(ap.name)}</div></div>
      <span class="status ${below ? 'bad' : 'ok'}">${below ? `${below} h unter Minima` : 'Über Minima'}</span>
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

function flightPlan(dep, p) {
  const aps = (B?.airports || []).filter((a) => !a.error);
  const legs = []; let t = dep;
  for (let k = 0; k < aps.length - 1; k++) {
    const a = aps[k], b = aps[k + 1];
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
    legs.push({ from: a.id, to: b.id, dist, tc, wind, hw, gs, wca: wca / RAD, min, fuel: (min / 60) * p.burn, dep: t, arr: t + min * 6e4 });
    t += min * 6e4 + (k < aps.length - 2 ? p.stop * 6e4 : 0);
  }
  const eta = {}; if (aps[0]) eta[aps[0].id] = { t: dep, kind: 'Abflug' };
  legs.forEach((l) => { eta[l.to] = { t: l.arr, kind: 'Ankunft' }; });
  const flight = legs.reduce((s, l) => s + l.min, 0), trip = legs.reduce((s, l) => s + l.fuel, 0);
  const reserve = (p.reserve / 60) * p.burn, taxi = p.taxi * (p.stop > 0 ? Math.max(1, legs.length) : 1);
  return { dep, legs, eta, flight, dist: legs.reduce((s, l) => s + l.dist, 0), trip, reserve, taxi, total: trip + reserve + taxi, end: t };
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
  const mm = p.depTime ? +p.depTime.split(':')[1] || 0 : 0;
  for (let d = 0; d <= SPAN; d++) {
    let ok = false;
    const dep = B.start + d * H + mm * 6e4;
    if (d < SPAN && dep >= Date.now() - H) {
      const fp = flightPlan(dep, p);
      ok = Object.entries(fp.eta).every(([id, e]) => { const i = hourOf(e.t), hs = byId[id]; return i != null && hs && hs[i].status === 'ok' && hs[i].day; });
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
    <thead><tr><th>Etappe</th><th>Distanz</th><th>rwK</th><th>Wind</th><th>GS</th><th>Zeit</th><th>Abflug → Ankunft</th><th>Kraftstoff</th></tr></thead>
    <tbody>${fp.legs.map((l) => `<tr><td><b>${esc(l.from)} → ${esc(l.to)}</b></td><td>${Math.round(l.dist)} NM</td><td>${p2(Math.round(l.tc)).padStart(3, '0')}°</td>
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

function flugView() {
  const p = plan(), s = settings();
  const dep = depMs(p), d0 = new Date();
  const days = [0, 1, 2].map((k) => { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + k)); return `<option value="${k}"${+p.depDay === k ? ' selected' : ''}>${['Heute', 'Morgen', 'Übermorgen'][k]}, ${dayLabel(d.getTime())}</option>`; }).join('');
  const num = (k, label, unit, val, step = 1) => `<li><label class="row"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" data-p="${k}" value="${val}" step="${step}" min="0"> ${unit}</span></label></li>`;
  const custom = p.custom[p.ac];
  const ck = checks();
  const fp = B ? flightPlan(dep, p) : null;
  return `
  <p class="group-label">Flugzeug</p>
  <ul class="group">
    <li><label class="row"><span>Typ</span><select data-p="ac">${Object.entries(AIRCRAFT).map(([k, a]) => `<option value="${k}"${k === p.ac ? ' selected' : ''}>${a.name}</option>`).join('')}</select></label></li>
    ${num('tas', 'Reisegeschwindigkeit (TAS)', 'kt', p.tas)}
    ${num('burn', 'Verbrauch', 'l/h', p.burn)}
    <li><div class="row"><span>Kraftstoff</span><span class="detail">${esc(p.acData.fuel)}</span></div></li>
    ${custom ? '<li><button class="row center" id="acReset">Werte des Typs wiederherstellen</button></li>' : ''}
  </ul>
  <p class="group-note">Richtwerte bei ca. 65–75 % Leistung. Mit dem Flughandbuch (POH/AFM) deines Flugzeugs abgleichen und hier anpassen.</p>

  <p class="group-label">Flug</p>
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
  <p class="group-note">Zuschlag: Steigflug, Abflug- und Anflugverfahren. Aufenthalt 0 = Plätze werden nur überflogen.</p>

  <p class="group-label">Etappen${B ? ' · ' + esc(B.ids.join(' → ')) : ''}</p>
  <div class="card">${fp ? planDetailsHTML(fp, p) : '<p class="group-note">Zuerst im Briefing eine Route laden.</p>'}</div>

  <p class="group-label">Checkliste Flugvorbereitung</p>
  <ul class="group">${CHECKS.map(([k, t]) => `<li><label class="row check-row"><input type="checkbox" class="check" data-c="${k}"${ck[k] ? ' checked' : ''}><span>${esc(t)}${k === 'fuel' && fp?.legs.length ? ` <b class="num">(${Math.ceil(fp.total)} l)</b>` : ''}</span></label></li>`).join('')}
    <li><button class="row center" id="ckReset">Häkchen zurücksetzen</button></li></ul>
  <p class="group-note">Links: <a href="https://www.flugwetter.de" target="_blank" rel="noopener">DWD Flugwetter</a> · <a href="https://aip.dfs.de" target="_blank" rel="noopener">DFS AIP</a> · <a href="https://secais.dfs.de" target="_blank" rel="noopener">DFS NOTAM</a></p>`;
}

function flugMount() {
  const keep = () => { const st = $('scroll').scrollTop; route(); $('scroll').scrollTop = st; };
  document.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('change', () => {
    const st = store.get('plan', {}), k = el.dataset.p;
    st.custom = st.custom || {};
    if (k === 'tas' || k === 'burn') {
      const ac = st.ac || PLAN_DEFAULTS.ac;
      st.custom[ac] = { ...(st.custom[ac] || {}), [k]: Math.max(1, parseFloat(el.value) || 1) };
    } else if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.type === 'number') st[k] = Math.max(0, parseFloat(el.value) || 0);
    else st[k] = el.value;
    store.set('plan', st); keep();
  }));
  $('acReset')?.addEventListener('click', () => { const st = store.get('plan', {}); delete st.custom?.[plan().ac]; store.set('plan', st); keep(); });
  document.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => { const c = checks(); c[el.dataset.c] = el.checked; store.set('checks', c); }));
  $('ckReset').addEventListener('click', () => { store.set('checks', {}); keep(); });
  $('pdf')?.addEventListener('click', () => { location.hash = '#briefing'; setTimeout(exportPDF, 150); });
}

// Druckteil: Flugplanung + Checkliste
function printPlanHTML(fp, p) {
  const ck = checks();
  return `<div class="print-only">
    <h2 class="sec">Flugplanung · ${esc(p.acData.name)} · TAS ${p.tas} kt · ${p.burn} l/h · ${p.alt} ft</h2>
    <div class="card">${planDetailsHTML(fp, p)}</div>
    <h2 class="sec">Checkliste</h2>
    <div class="card"><ul class="print-checks">${CHECKS.map(([k, t]) => `<li>${ck[k] ? '☑' : '☐'} ${esc(t)}</li>`).join('')}</ul></div>
  </div>`;
}

// ---------- Ansicht „Briefing" ----------
function briefingView() {
  const s = settings();
  const ids = store.get('currentIds', []);
  const routes = store.get('routes', []);
  let html = `
  <form class="search noprint" id="f">
    <label class="field">${SYM.search}<input id="ids" type="text" placeholder="Flugplätze, z. B. EDFE EDDF EDQD" value="${esc(ids.join(' '))}" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Flugplätze (ICAO)"></label>
    <button class="btn-fill" type="submit">Laden</button>
  </form>
  ${routes.length ? `<div class="chips noprint">${routes.map((r, i) => `<button class="chip" data-r="${i}">${esc(r.name)}</button>`).join('')}</div>` : ''}`;
  if (loading) return html + `<div class="empty"><div class="spinner"></div><p>Lade METAR, TAF und Vorhersage …</p></div>`;
  if (!B) return html + `<div class="empty">${ICONS.cloud}<h3>Wetter für deinen Flug</h3>
    <p>Gib einen Flugplatz oder eine Route ein – ICAO-Kennungen in Flugreihenfolge – und tippe auf „Laden".</p>
    <button class="btn-tinted" id="demoBtn">Beispiel ansehen</button></div>`;

  const all = B.airports.map((ap) => ({ ap, hours: ap.error ? null : computeHours(ap, B.start, s) }));
  const ok = all.filter((x) => x.hours);
  const age = Math.round((Date.now() - B.fetchedAt) / 6e4);
  const p = plan(), fp = flightPlan(depMs(p), p);
  const win = ok.length ? depWindows(ok, p, s) : [];
  const pc = B.profile && fp.legs.length ? profileCheck(fp, { ...s, alt: p.alt }) : null;
  const routeTxt = B.ids.join(' → ');

  html += `
  <div class="print-only print-head">
    <h1>Ceiling – Flugvorbereitung</h1>
    <p><b>${esc(routeTxt)}</b></p>
    <p>Export: <span id="exportTime"></span> · Daten abgerufen: ${utc(B.fetchedAt)}${B.dataAt ? ` (METAR/TAF-Stand ${hhmm(B.dataAt)}Z)` : ''} · Minima: ${s.minCeil} ft / ${s.minVis} km / Wind ${s.maxWind} kt, Böen ${s.maxGust} kt</p>
  </div>
  <p class="meta noprint">${esc(routeTxt)} · abgerufen ${utc(B.fetchedAt)}${B.dataAt ? ` · METAR/TAF-Stand ${hhmm(B.dataAt)}Z` : ''}</p>
  ${B.demo ? '<p class="banner demo">Beispieldaten – kein echtes Wetter</p>' : ''}
  ${age > 60 ? `<p class="banner noprint">Daten sind ${age < 120 ? age + ' min' : Math.round(age / 60) + ' h'} alt – oben rechts aktualisieren.</p>` : ''}
  ${B.errors?.length ? `<p class="banner">${B.errors.map(esc).join(' · ')}</p>` : ''}

  <h2 class="sec">Jetzt</h2>
  ${tilesHTML(all, fp)}

  <a class="card plancard" href="#flug">
    <span class="wc-icon">${ICONS.plane}</span>
    <div class="pc-main"><div class="wc-title">${esc(p.acData.name)} · Abflug ${dayLabel(fp.dep).slice(0, 2)} ${hhmm(fp.dep)}Z</div>
      <div class="wc-sub">${fp.legs.length ? `${Math.round(fp.dist)} NM · ${fmtDur(fp.flight)} · Ankunft ${hhmm(fp.end)}Z · ${Math.ceil(fp.total)} l inkl. Reserve` : 'Einzelner Platz – für Etappen eine Route laden'}</div></div>
    <span class="chevron">›</span>
  </a>

  <div class="card wincard ${win.length ? 'ok' : 'bad'}">
    <span class="wc-icon">${win.length ? SYM.ok : SYM.warn}</span>
    <div><div class="wc-title">${win.length ? 'Mögliche Abflugzeiten' : 'Keine passende Abflugzeit'}</div>
      <div class="wc-sub">Abflug, Ankunft${B.profile ? ' und Strecke' : ''} über deinen Minima, bei Tageslicht – mit ${esc(p.acData.name)}</div>
      ${win.length ? `<div class="wins">${win.map(([a, b]) => `<span class="win">${WD[new Date(a).getUTCDay()]} ${hhmm(a)}${b > a ? '–' + hhmm(b) : ''} UTC</span>`).join('')}</div>` : ''}
    </div>
  </div>

  <h2 class="sec">48 Stunden</h2>
  <div class="card">${ok.length ? timelineHTML(ok, fp) : ''}
    <div class="legend"><span><i class="cat-VFR"></i>VFR</span><span><i class="cat-MVFR"></i>MVFR</span><span><i class="cat-IFR"></i>IFR</span><span><i class="cat-LIFR"></i>LIFR</span>
    <span><i class="lg-below"></i>unter Minima</span><span><i class="lg-tempo2"></i>TEMPO unter Minima</span></div>
  </div>

  ${printPlanHTML(fp, p)}

  <div class="card noprint pick">
    <input type="range" id="slider" min="0" max="${SPAN - 1}" step="1" value="${sel}" aria-label="Stunde wählen">
    <div id="detail">${ok.length ? detailHTML(ok) : ''}</div>
  </div>

  ${B.profile && fp.legs.length ? `<h2 class="sec noprint">Strecke</h2>
  <section class="card ap">
    <div class="ap-head"><div><h3>Streckenprofil</h3><div class="ap-name">Wolkenbasis und Gelände zur geplanten Überflugzeit</div></div>
      ${pc ? `<span class="status ${pc.bad ? 'bad' : 'ok'}">${pc.gap === Infinity ? 'keine tiefen Wolken' : `min. ${Math.round(pc.gap / 100) * 100} ft über Grund`}</span>` : ''}</div>
    ${profileSVG(fp, s, p)}
    <div class="legend"><span><i class="lg-cloud"></i>Wolken (Modell)</span><span><i class="lg-terrain"></i>Gelände</span><span><i class="lg-taf"></i>Reiseflughöhe</span><span><i class="lg-below"></i>Abstand Wolken–Gelände unter Minimum</span></div>
    ${pc && pc.gap !== Infinity ? `<p class="sun">Engste Stelle: ${Math.round(pc.d)} NM nach Abflug, ca. ${hhmm(pc.t)}Z – Basis ${Math.round(pc.cb / 100) * 100} ft MSL, Gelände ${Math.round(pc.terr / 100) * 100} ft.${pc.inCloud ? ' <span class="bad">Reiseflughöhe liegt dort zu nah an oder über der Wolkenbasis.</span>' : ''}</p>` : ''}
    <p class="sun">Gelände entlang der direkten Linie (ohne Hindernisse), Wolkenbasis aus dem Modell – nur zur Orientierung.</p>
  </section>` : ''}

  <h2 class="sec noprint">Plätze</h2>
  ${all.map(({ ap, hours }) => airportCard(ap, hours, s, fp)).join('')}

  <p class="foot">Quellen: METAR/TAF aviationweather.gov (NOAA), Flugplätze OurAirports, Modell und Gelände Open-Meteo (u. a. DWD ICON). Modell-Ceiling ist eine grobe Schätzung aus Bewölkung in Druckflächen.
  Keine amtliche Flugwetterberatung – vor dem Flug offizielle Quellen (DWD) prüfen. Kategorien: VFR &gt; 3000 ft und &gt; 8 km, MVFR ≤ 3000 ft / ≤ 8 km, IFR &lt; 1000 ft / &lt; 4,8 km, LIFR &lt; 500 ft / &lt; 1,6 km.</p>`;
  return html;
}

function briefingMount() {
  $('f').addEventListener('submit', (e) => { e.preventDefault(); $('ids').blur(); loadBriefing(parseIds($('ids').value)); });
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const r = store.get('routes', [])[b.dataset.r]; if (r) loadBriefing(r.ids);
  }));
  $('demoBtn')?.addEventListener('click', () => { B = makeDemo(); sel = 0; route(); });
  $('pdf')?.addEventListener('click', exportPDF);
  $('reload')?.addEventListener('click', () => B.demo ? (B = makeDemo(), route()) : loadBriefing(B.ids));
  $('save')?.addEventListener('click', () => {
    const name = prompt('Name der Route', B.ids.join(' – '));
    if (!name?.trim()) return;
    const routes = store.get('routes', []); routes.push({ name: name.trim(), ids: B.ids }); store.set('routes', routes); route();
  });
  if (!B || loading) return;
  const s = settings();
  const all = B.airports.filter((a) => !a.error).map((ap) => ({ ap, hours: computeHours(ap, B.start, s) }));
  const slider = $('slider');
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
  slider?.addEventListener('input', (e) => setSel(+e.target.value));
  document.querySelectorAll('.tl-c').forEach((c) => c.addEventListener('click', () => setSel(+c.dataset.i)));
  document.querySelectorAll('svg.chart').forEach((svg) => svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * +svg.dataset.w;
    setSel(Math.floor(((vx - +svg.dataset.l) / +svg.dataset.pw) * SPAN));
  }));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () =>
    $('ap-' + b.dataset.go)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })));
  setSel(sel);
}

// PDF: Druckansicht des Browsers (am iPad: Teilen › Drucken › Als PDF sichern / Teilen)
function exportPDF() {
  const now = Date.now();
  const el = $('exportTime'); if (el) el.textContent = `${utc(now)} (${local(now)} Ortszeit)`;
  const d = new Date(now);
  const old = document.title;
  document.title = `Ceiling ${B.ids.join('-')} ${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`;
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

// ---------- Bereiche = Menüpunkte ----------
const SECTIONS = [
  {
    id: 'briefing', title: 'Briefing', icon: ICONS.cloud,
    actions: () => B && !loading ? `<button class="btn-text sym" id="reload" aria-label="Aktualisieren" title="Aktualisieren">${SYM.reload}</button><button class="btn-text sym" id="save" aria-label="Route merken" title="Route merken">${SYM.bookmark}</button><button class="btn-text sym" id="pdf" aria-label="Als PDF exportieren" title="Als PDF exportieren">${SYM.share}</button>` : '',
    render: briefingView, mount: briefingMount,
  },
  {
    id: 'flug', title: 'Flug', icon: ICONS.plane,
    actions: () => B ? `<button class="btn-text sym" id="pdf" aria-label="Als PDF exportieren" title="Als PDF exportieren">${SYM.share}</button>` : '',
    render: flugView, mount: flugMount,
  },
  {
    id: 'routen', title: 'Routen', icon: ICONS.route,
    actions: () => `<button class="btn-text icon" id="add" aria-label="Neue Route">＋</button>`,
    render: () => {
      const routes = store.get('routes', []);
      if (!routes.length) return `<p class="group-note">Noch keine Routen. Tippe oben rechts auf ＋ oder im Briefing auf „Merken".</p>`;
      return `<ul class="group">${routes.map((r, i) =>
        `<li><a class="row" href="#routen/${i}"><span>${esc(r.name)}</span><span class="detail">${esc(r.ids.join(' → '))} <span class="chevron">›</span></span></a></li>`).join('')}</ul>`;
    },
    mount: () => $('add').addEventListener('click', () => {
      const ids = parseIds(prompt('Flugplätze in Flugreihenfolge (ICAO), z. B. EDFE EDDN EDQD') || '');
      if (!ids.length) return;
      const name = prompt('Name der Route', ids.join(' – ')) || ids.join(' – ');
      const routes = store.get('routes', []); routes.push({ name: name.trim(), ids }); store.set('routes', routes); route();
    }),
    detail: (nr) => {
      const routes = store.get('routes', []); const r = routes[nr];
      if (!r) return { title: 'Nicht gefunden', html: '' };
      return {
        title: r.name,
        html: `<ul class="group"><li><div class="row"><span>Plätze</span><span class="detail">${esc(r.ids.join(' → '))}</span></div></li></ul>
          <ul class="group gap"><li><button class="row center" id="go">Briefing laden</button></li></ul>
          <ul class="group gap"><li><button class="row danger" id="del">Route löschen</button></li></ul>`,
        mount: () => {
          $('go').addEventListener('click', () => { location.hash = '#briefing'; loadBriefing(r.ids); });
          $('del').addEventListener('click', () => {
            if (confirm('Diese Route wirklich löschen?')) { routes.splice(nr, 1); store.set('routes', routes); location.hash = '#routen'; }
          });
        },
      };
    },
  },
  {
    id: 'einstellungen', title: 'Einstellungen', icon: ICONS.gear,
    render: () => {
      const s = settings(), coords = store.get('coords', {});
      const num = (k, label, unit, step) => `<li><label class="row"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" data-k="${k}" value="${s[k]}" step="${step}" min="0"> ${unit}</span></label></li>`;
      return `
      <p class="group-label">Persönliche Minima</p>
      <ul class="group">${num('minCeil', 'Wolkenuntergrenze', 'ft', 100)}${num('minVis', 'Sicht', 'km', 0.5)}${num('maxWind', 'Wind max.', 'kt', 1)}${num('maxGust', 'Böen max.', 'kt', 1)}</ul>
      <p class="group-note">Zeiten unter diesen Werten werden rot markiert und zählen nicht als Flugfenster.</p>

      <p class="group-label">Eigene Flugplätze</p>
      <ul class="group">${Object.entries(coords).map(([id, c]) => `<li><div class="row"><span>${esc(id)} <span class="detail">${esc(c.name || '')} ${(+c.lat).toFixed(3)}, ${(+c.lon).toFixed(3)}</span></span><button class="btn-text danger-text" data-del="${esc(id)}">Löschen</button></div></li>`).join('')}
      <li><button class="row" id="addc">Platz mit Koordinaten hinzufügen …</button></li></ul>
      <p class="group-note">Nur nötig, wenn ein kleiner Platz nicht gefunden wird (z. B. Ultraleicht- oder Segelfluggelände).</p>

      <p class="group-label">Ausprobieren</p>
      <ul class="group"><li><button class="row" id="demo">Beispieldaten anzeigen</button></li></ul>

      <p class="group-label">Daten</p>
      <ul class="group"><li><button class="row danger" id="reset">Alle Daten löschen</button></li></ul>
      <p class="group-note">Routen, Minima und das letzte Briefing werden nur auf diesem Gerät gespeichert.<br>
      Quellen: aviationweather.gov (METAR, TAF), OurAirports (Flugplätze), Open-Meteo (Modell, Gelände). METAR/TAF werden alle 15 Minuten aktualisiert. Keine amtliche Flugwetterberatung.</p>`;
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
      $('demo').addEventListener('click', () => { B = makeDemo(); sel = 0; location.hash = '#briefing'; });
      $('reset').addEventListener('click', () => {
        if (confirm('Alle Daten löschen? Das lässt sich nicht rückgängig machen.')) { localStorage.clear(); B = null; route(); }
      });
    },
  },
];

// ---------- Navigation ----------
const $ = (id) => document.getElementById(id);
$('nav').innerHTML = SECTIONS.map((s) =>
  `<li><a href="#${s.id}" data-id="${s.id}">${s.icon}<span>${s.title}</span></a></li>`).join('');

function route() {
  const [id, sub] = location.hash.slice(1).split('/');
  const section = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.id === section.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  let title = section.title, html, mount = section.mount, actions = section.actions?.() || '';
  if (sub !== undefined && section.detail) {
    const d = section.detail(Number(sub));
    title = d.title; html = d.html; mount = d.mount; actions = '';
    $('back').hidden = false;
    $('back').onclick = () => { location.hash = '#' + section.id; };
  } else {
    html = section.render();
    $('back').hidden = true;
  }
  $('largeTitle').textContent = title;
  $('barTitle').textContent = title;
  $('barActions').innerHTML = actions;
  $('view').innerHTML = html;
  $('view').dataset.section = section.id;
  $('scroll').scrollTop = 0;
  document.title = `${title} – Ceiling`;
  mount?.();
}

// Großer Titel wird beim Scrollen zum kleinen Titel in der Leiste
$('scroll').addEventListener('scroll', () => {
  document.querySelector('.bar').classList.toggle('scrolled', $('scroll').scrollTop > 40);
}, { passive: true });

addEventListener('hashchange', route);
if (B) sel = Math.max(0, Math.min(SPAN - 1, Math.floor((Date.now() - B.start) / H)));
if (new URLSearchParams(location.search).has('demo')) B = makeDemo();
route();

// ---------- Offline-Fähigkeit ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
