// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Noms + couleurs corrects, étiquette permanente (zoom >= 13)

import { distanceMeters } from "./util.js?v=3";

// Bump si tu régénères data/stations.min.json
const DATA_VERSION = "21";

/* ───────── Libellés + couleurs ───────── */
const MODE_LABEL = {
  metro: "Métro",
  rer: "RER",
  transilien: "Transilien",
  ter: "TER",
  tgv: "TGV",
  tram: "Tram",
};

const METRO_COLORS = {
  "1":"#FFCD00","2":"#1D87C9","3":"#9FCE66","3BIS":"#84C28E","4":"#A0006E",
  "5":"#F28E00","6":"#76C696","7":"#F59CB2","7BIS":"#89C8C5","8":"#CE64A6",
  "9":"#B0BD00","10":"#D6C178","11":"#704B1C","12":"#007852","13":"#99B4CB","14":"#662483"
};
const RER_COLORS = { A:"#E11E2B", B:"#0072BC", C:"#F6A800", D:"#2E7D32", E:"#8E44AD" };
const TRAM_COLORS = {
  T1:  "#003CA6", // bleu
  T2:  "#CF009E", // magenta
  T3:  "#FF7E2E", // fallback si jamais "T3" seul arrive
  T3A: "#FF7E2E", // orange
  T3B: "#00AE41", // vert
  T4:  "#DFAF47", // ocre
  T5:  "#62259D", // violet
  T6:  "#E2231A", // rouge
  T7:  "#704B1C", // brun
  T8:  "#837902", // olive
  T9:  "#3C91DC", // bleu clair
  T10: "#6E6E00", // kaki
  T11: "#F58F53", // corail
  T12: "#A50034", // bordeaux
  T13: "#8D653D", // sépia
  T14: "#00A092"  // vert-bleu
};
const TRANSILIEN_COLORS = { H:"#0064B0", J:"#9D2763", L:"#5C4E9B", N:"#00936E", P:"#E2001A", U:"#6F2C91", K:"#2E3192", R:"#00A4A7" };

// Couleurs par mode quand la ligne est inconnue
const DEFAULT_BY_MODE = {
  metro: "#1D87C9",
  rer: "#0072BC",
  tram: "#00A36D",
  transilien: "#2E3192",
  ter: "#0A74DA",
  tgv: "#A1006B",
};

// zoom mini pour afficher les étiquettes permanentes
const ZOOM_LABELS = 13;

/* ───────── helpers ───────── */
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

function flatten(o){
  if (o && typeof o === "object" && o.properties && typeof o.properties === "object"){
    return { ...o.properties, ...o, ...o.properties };
  }
  return o || {};
}

function firstNonEmptyRow(o, keys){
  for (const k of keys){
    const v = o[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function cleanName(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+/i, "");
  s = s.replace(/^Gare\s+/i, "");
  s = s.replace(/\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*/ig, " ");
  s = s.replace(/\s*[-–]\s*RER\s+[A-E]\b/ig, "");
  s = s.replace(/\s*[-–]\s*Ligne\s+[A-Z0-9]+$/i, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function modeKey(m) {
  const s = String(m || "").toLowerCase();
  if (s.startsWith("met")) return "metro";
  if (s.includes("rer")) return "rer";
  if (s.includes("tram") || /^t\d/i.test(s)) return "tram";
  if (s.includes("transilien") || s.includes("train")) return "transilien";
  if (s === "ter") return "ter";
  if (s === "tgv" || s.includes("lgv")) return "tgv";
  return null;
}

function normalizeLine(raw, mode) {
  const S = String(raw || "").toUpperCase();
  if (!S) return null;

  let m = S.match(/\bRER\s*([A-E])\b/);
  if (m) return m[1];

  if (mode === "metro") {
    m = S.match(/\b(?:M|MÉTRO|METRO|LIGNE)\s*(3BIS|7BIS)\b/); if (m) return m[1];
    m = S.match(/\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b/); if (m) return m[1];
  }
  if (mode === "tram") {
    m = S.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1]}`;
    m = S.match(/\bTRAM\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1]}`;
  }
  if (mode === "transilien") {
    m = S.match(/\b([HJKLNRPU])\b/); if (m) return m[1];
  }
  return null;
}

/* Couleurs depuis la donnée source (route_color, couleur, rgb(...), etc.) */
const COLOR_KEYS = [
  "route_color","couleur","couleur_hex","couleur_ligne","color","hexa","hex","code_couleur","couleur_rgb"
];

function parseHexColor(x){
  if (x == null) return null;
  const s = String(x).trim();
  let m = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (m) return `#${m[1].toUpperCase()}`;
  m = s.match(/^0x([0-9A-Fa-f]{6})$/);
  if (m) return `#${m[1].toUpperCase()}`;
  m = s.match(/^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (m){
    const r = Math.max(0, Math.min(255, Number(m[1])));
    const g = Math.max(0, Math.min(255, Number(m[2])));
    const b = Math.max(0, Math.min(255, Number(m[3])));
    const to2 = n => n.toString(16).toUpperCase().padStart(2,"0");
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  }
  return null;
}

/* ⚠️ ICI: on fait PRIMER la palette officielle, et on ne prend sourceHex qu'en secours */
function colorFor(mode, line, sourceHex) {
  const m = (mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro") {
    const c = METRO_COLORS[l.replace(/^0+/,"")];
    return c || sourceHex || DEFAULT_BY_MODE.metro;
  }
  if (m === "rer") {
    const c = RER_COLORS[l];
    return c || sourceHex || DEFAULT_BY_MODE.rer;
  }
  if (m === "tram") {
    const key = l.startsWith("T") ? l : ("T" + l);
    const c = TRAM_COLORS[key];
    return c || sourceHex || DEFAULT_BY_MODE.tram;
  }
  if (m === "transilien") {
    const c = TRANSILIEN_COLORS[l];
    return c || sourceHex || DEFAULT_BY_MODE.transilien;
  }
  if (m === "ter") return sourceHex || DEFAULT_BY_MODE.ter;
  if (m === "tgv") return sourceHex || DEFAULT_BY_MODE.tgv;
  return sourceHex || "#666";
}

function badgeText(mode, line){
  const m = (mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro")      return l || "M";
  if (m === "rer")        return l ? `RER ${l}` : "RER";
  if (m === "tram")       return l || "T";
  if (m === "transilien") return l || "TN";
  return (MODE_LABEL[m] || m || "?").toUpperCase();
}

function iconFor(row) {
  const color = colorFor(row.mode, row.line, row.colorHex);
  const html = `<div style="width:14px;height:14px;border-radius:50%;background:${color};
    border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`;
  return L.divIcon({ className: "stn", html, iconSize: [18,18], iconAnchor: [9,9] });
}

function tooltipHtml(row){
  const color = colorFor(row.mode, row.line, row.colorHex);
  const btxt = badgeText(row.mode, row.line);
  const suffix =
    row.mode === "metro" && row.line ? ` — Ligne ${row.line}` :
    row.mode === "rer" && row.line ? ` — RER ${row.line}` :
    row.mode === "tram" && row.line ? ` — Tram ${row.line.replace(/^T/i,"")}` :
    row.mode === "transilien" && row.line ? ` — Ligne ${row.line}` : "";

  return `<div class="station-tt">
    <span class="station-badge" style="background:${color}">${esc(btxt)}</span>
    <span class="station-name">${esc(row.name)}</span>
    <span style="opacity:.85">${esc(suffix)}</span>
  </div>`;
}

function nameLabelHtml(row){
  const color = colorFor(row.mode, row.line, row.colorHex);
  const btxt = badgeText(row.mode, row.line);
  return `<span class="stn-badge" style="background:${color}">${esc(btxt)}</span>
          <span class="station-name">${esc(row.name)}</span>`;
}

function popupHtml(row){
  const mode = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();
  let detail = "";
  if (row.mode === "metro" && row.line) detail = `Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line) detail = `RER ${row.line}`;
  else if (row.mode === "tram" && row.line) detail = `Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.mode === "transilien" && row.line) detail = `Ligne ${row.line}`;
  return `<div><div style="font-weight:700;margin-bottom:.25rem">${esc(row.name)}${detail? " — "+esc(detail):""}</div>
  <div style="opacity:.85">${esc(mode)}</div></div>`;
}

/* ───────── extraction nom/ligne (fallback) ───────── */
const NAME_KEYS = [
  "name","nom","nom_gare","nomlong","nom_long","libelle","libelle_gare","label","intitule",
  "stop_name","nom_station","zdl_nom","nom_zdl","nom_commune","appellation","appellation_longue",
  "nom_de_la_gare","gare","station"
];
const CITY_KEYS = ["commune","ville","city","localite","locality","arrondissement","commune_principale"];

const LINE_KEYS = [
  "line","ligne","nom_ligne","code_ligne","ligne_long","ligne_nom","ligne_code",
  "indice_ligne","indice_lig","route_short_name","route_id","id_ligne","id_ref_ligne",
  "reseau_ligne","code","libelle_ligne","num_ligne","numero_ligne","ligne_numero","ligne_indice"
];

function guessModeFromContext(row, nameU, lineU){
  if (/\bRER\s*[A-E]?\b/.test(nameU) || /\bRER\s*[A-E]?\b/.test(lineU)) return "rer";
  if (/\b(?:M|MÉTRO|METRO)\s*\d{1,2}\b/.test(nameU) || /\bMETRO\b/.test(lineU)) return "metro";
  if (/\bT\s*\d{1,2}[AB]?\b/.test(nameU) || /\bTRAM\b/.test(lineU)) return "tram";
  const isSncf = ("uic" in row) || ("code_ligne" in row) || ("codeuic" in row) || ("voyageurs" in row);
  if (isSncf){
    if (/\bTGV\b/.test(nameU) || /\bTGV\b/.test(lineU)) return "tgv";
    if (/\bTER\b/.test(nameU) || /\bTER\b/.test(lineU)) return "ter";
    return "transilien";
  }
  return null;
}

function extractLine(row, mode, rawLine, nameU){
  let Lx = normalizeLine(rawLine, mode);
  if (Lx) return Lx;
  if (mode === "rer"){ const m = nameU.match(/\bRER\s*([A-E])\b/); if (m) return m[1]; }
  if (mode === "metro"){
    let m = nameU.match(/\b(?:M|MÉTRO|METRO)\s*(3BIS|7BIS)\b/); if (m) return m[1];
    m = nameU.match(/\b(?:M|MÉTRO|METRO)\s*([0-9]{1,2})\b/); if (m) return m[1];
  }
  if (mode === "tram"){ const m = nameU.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1].toUpperCase()}`; }
  if (mode === "transilien"){ const m = nameU.match(/\b([HJKLNRPU])\b/); if (m) return m[1]; }
  return null;
}

/* ───────── chargement ───────── */
let _rowsCache = null;

async function loadOnce(){
  if (_rowsCache) return _rowsCache;

  const v = typeof window !== "undefined" ? (window.APP_VERSION || "") : "";
  const urls = [
    `./data/stations.min.json?v=${DATA_VERSION}-${v}`,
    `./data/stations.min.json?v=${DATA_VERSION}`,
    `./data/stations.min.json`
  ];

  let rawRows = [];
  for (const url of urls){
    try{
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json)) rawRows = json;
      else if (json && Array.isArray(json.features)) rawRows = json.features; // GeoJSON
      if (rawRows.length){ console.debug(`[Stations] chargées: ${rawRows.length} via ${url}`); break; }
    }catch{}
  }

  const out = [];
  for (const r0 of rawRows){
    const r = flatten(r0);

    // coords
    let lat = Number(firstNonEmptyRow(r, ["lat","latitude"]));
    let lon = Number(firstNonEmptyRow(r, ["lon","lng","longitude"]));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)){
      const g = r0 && r0.geometry && Array.isArray(r0.geometry.coordinates) ? r0.geometry.coordinates : null;
      if (g && g.length >= 2){ lon = Number(g[0]); lat = Number(g[1]); }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // nom
    let rawName = firstNonEmptyRow(r, NAME_KEYS);
    let city = firstNonEmptyRow(r, CITY_KEYS);
    let name = cleanName(rawName);
    if (!name){
      if (rawName) name = String(rawName).trim();
      if ((!name || name.toLowerCase()==="gare") && city) name = `Gare de ${city}`;
      if (!name) name = "Gare";
    }

    // mode + ligne
    let mode = modeKey(firstNonEmptyRow(r, ["mode","reseau","transport","mode_principal","network"]));
    const nameU = String(rawName || name).toUpperCase();
    const rawLine = firstNonEmptyRow(r, LINE_KEYS);
    const lineU = String(rawLine || "").toUpperCase();
    if (!mode) mode = guessModeFromContext(r, nameU, lineU) || null;
    if (!mode) continue;

    const line = extractLine(r, mode, rawLine, nameU);

    // couleur depuis la source (si fournie)
    const colRaw = firstNonEmptyRow(r, COLOR_KEYS);
    const colorHex = parseHexColor(colRaw);

    out.push({ name, mode, line, lat, lon, colorHex });
  }

  _rowsCache = out;
  console.debug(`[Stations] prêtes: ${out.length}`);
  return _rowsCache;
}

/* ───────── contrôleur ───────── */
export function makeStationsController({ map } = {}){
  const _map = map || null;

  // Groupes de couches pour markers + étiquettes par mode
  const groups = {
    markers: {
      metro: L.layerGroup(), rer: L.layerGroup(), tram: L.layerGroup(),
      transilien: L.layerGroup(), ter: L.layerGroup(), tgv: L.layerGroup(),
    },
    labels: {
      metro: L.layerGroup(), rer: L.layerGroup(), tram: L.layerGroup(),
      transilien: L.layerGroup(), ter: L.layerGroup(), tgv: L.layerGroup(),
    }
  };

  let all = [];
  let lastWanted = new Set(Object.keys(groups.markers));

  function attachOrRemoveLayers(wanted){
    for (const m of Object.keys(groups.markers)){
      const layer = groups.markers[m];
      const shouldShow = wanted.has(m) && layer.getLayers().length > 0;
      if (_map){
        if (shouldShow && !_map.hasLayer(layer)) layer.addTo(_map);
        if (!shouldShow && _map.hasLayer(layer)) _map.removeLayer(layer);
      }
    }
    const showLabels = _map ? _map.getZoom() >= ZOOM_LABELS : false;
    for (const m of Object.keys(groups.labels)){
      const layer = groups.labels[m];
      const shouldShow = showLabels && wanted.has(m) && layer.getLayers().length > 0;
      if (_map){
        if (shouldShow && !_map.hasLayer(layer)) layer.addTo(_map);
        if (!shouldShow && _map.hasLayer(layer)) _map.removeLayer(layer);
      }
    }
  }

  function rebuild({ modesWanted, center, radiusMeters } = {}){
    for (const k of Object.keys(groups.markers)) groups.markers[k].clearLayers();
    for (const k of Object.keys(groups.labels))  groups.labels[k].clearLayers();

    const wanted = modesWanted instanceof Set ? modesWanted : new Set(Object.keys(groups.markers));
    lastWanted = wanted;

    const filterByRadius = Array.isArray(center) && Number.isFinite(radiusMeters) && radiusMeters > 0;

    for (const row of all){
      if (!wanted.has(row.mode)) continue;
      if (filterByRadius){
        const d = distanceMeters(center[0], center[1], row.lat, row.lon);
        if (d > radiusMeters) continue;
      }

      const mk = L.marker([row.lat, row.lon], { icon: iconFor(row) });
      mk.bindTooltip(tooltipHtml(row), { sticky: true, direction: "top" });
      mk.bindPopup(popupHtml(row));
      groups.markers[row.mode].addLayer(mk);

      const label = L.tooltip({
        permanent: true,
        className: "stn-name",
        direction: "top",
        offset: [0, -16],
        opacity: 1
      })
      .setLatLng([row.lat, row.lon])
      .setContent(nameLabelHtml(row));

      groups.labels[row.mode].addLayer(label);
    }

    attachOrRemoveLayers(wanted);
  }

  if (_map){
    _map.on("zoomend", () => attachOrRemoveLayers(lastWanted));
  }

  return {
    async ensure({ modesWanted, center, radiusMeters } = {}){
      if (!all.length) all = await loadOnce();
      rebuild({ modesWanted, center, radiusMeters });
    },
    refresh({ modesWanted, center, radiusMeters } = {}){
      rebuild({ modesWanted, center, radiusMeters });
    },
    clear(){
      for (const k of Object.keys(groups.markers)){
        groups.markers[k].clearLayers();
        if (_map && _map.hasLayer(groups.markers[k])) _map.removeLayer(groups.markers[k]);
      }
      for (const k of Object.keys(groups.labels)){
        groups.labels[k].clearLayers();
        if (_map && _map.hasLayer(groups.labels[k])) _map.removeLayer(groups.labels[k]);
      }
    }
  };
}

export default makeStationsController;
