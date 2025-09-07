// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Noms + couleurs corrects, étiquette permanente (zoom >= 13)
// Détection de ligne étendue + mode debug (?debugStations=1)

import { distanceMeters } from "./util.js?v=3";

// Bump si tu régénères data/stations.min.json
const DATA_VERSION = "17";

// Debug : ajoute ?debugStations=1 à l’URL pour loguer les cas sans ligne/couleur
const DEBUG = (typeof window !== "undefined") &&
  new URLSearchParams(window.location.search).has("debugStations");

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
const TRAM_COLORS = { T1:"#6F6F6F",T2:"#0096D7",T3:"#C77DB3","T3A":"#C77DB3","T3B":"#C77DB3",T4:"#5BC2E7",T5:"#A9CC51",T6:"#00A36D",T7:"#E98300",T8:"#B1B3B3",T9:"#C1002A",T10:"#6E4C9A",T11:"#575756",T12:"#0077C8",T13:"#008D36" };
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
    // GeoJSON Feature -> on remonte les props au niveau racine
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

/* ——— Détection de ligne ——— */
function normalizeLine(raw, mode) {
  const S = String(raw || "").toUpperCase();
  if (!S) return null;

  let m = S.match(/\bRER\s*([A-E])\b/);
  if (m) return m[1];

  if (mode === "metro") {
    m = S.match(/\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b/); if (m) return String(Number(m[1]));
    m = S.match(/\b([37])\s*BIS\b/); if (m) return m[1] === "3" ? "3BIS" : "7BIS";
    m = S.match(/\b(?:METRO[-\s]?)([0-9]{1,2})\b/); if (m) return String(Number(m[1]));
  }
  if (mode === "tram") {
    m = S.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1].toUpperCase()}`;
    m = S.match(/\bTRAM(?:WAY)?\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1].toUpperCase()}`;
  }
  if (mode === "transilien") {
    m = S.match(/\b(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b/); if (m) return m[1];
    m = S.match(/\b([HJKLNRPU])\b/); if (m) return m[1];
  }
  return null;
}

// Beaucoup plus de champs possibles
const LINE_KEYS = [
  // existants
  "line","ligne","nom_ligne","code_ligne","ligne_long","ligne_nom","ligne_code",
  "indice_ligne","indice_lig","route_short_name","route_long_name","route_desc",
  "route_id","id_ligne","id_ref_ligne","reseau_ligne","libelle_ligne",
  "num_ligne","numero_ligne","ligne_numero","ligne_indice",
  // variantes fréquentes
  "nomcourtligne","nomlongligne","ligne_courte","ligne_longue","short_name","long_name",
  "code","libelle","intitule","label","designation","commercial_short","commercial_long"
];

// Si aucune clé “classique” n’a permis d’extraire la ligne, on scanne toutes les chaînes
function searchLineAny(row, mode){
  for (const [k, v] of Object.entries(row)){
    if (v == null) continue;
    if (typeof v === "string") {
      const L = normalizeLine(v, mode);
      if (L) return L;
    } else if (Array.isArray(v)) {
      for (const item of v){
        if (typeof item === "string"){
          const L = normalizeLine(item, mode);
          if (L) return L;
        }
      }
    }
  }
  return null;
}

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

  // Essaie d’autres champs courants
  if (!Lx){
    for (const key of LINE_KEYS){
      const val = row[key];
      if (!val) continue;
      Lx = normalizeLine(val, mode);
      if (Lx) break;
    }
  }

  // Ratisser toutes les chaînes en dernier recours
  if (!Lx) Lx = searchLineAny(row, mode);

  // Bonus : tenter via le nom si mode connu
  if (!Lx){
    if (mode === "rer"){ const m = nameU.match(/\bRER\s*([A-E])\b/); if (m) Lx = m[1]; }
    if (mode === "metro"){
      let m = nameU.match(/\b(?:M|MÉTRO|METRO)\s*([0-9]{1,2})\b/); if (m) Lx = String(Number(m[1]));
      if (!Lx){ m = nameU.match(/\b([37])\s*BIS\b/); if (m) Lx = (m[1]==="3"?"3BIS":"7BIS"); }
    }
    if (mode === "tram"){ const m = nameU.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) Lx = `T${m[1].toUpperCase()}`; }
    if (mode === "transilien"){ const m = nameU.match(/\b([HJKLNRPU])\b/); if (m) Lx = m[1]; }
  }

  return Lx || null;
}

/* Couleurs depuis la donnée source (route_color, couleur, rgb(...), etc.) */
const COLOR_KEYS = [
  "route_color","route_text_color",               // GTFS
  "couleur","couleur_hex","couleur_ligne","couleur_rgb",
  "color","hexa","hex","code_couleur",
  "couleur_de_ligne","couleur_de_trait","couleur_de_fond",
  "color_hex","texte_couleur","fond_couleur"
];

function parseHexColor(x){
  if (x == null) return null;
  const s = String(x).trim();
  // #RRGGBB ou RRGGBB
  let m = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (m) return `#${m[1].toUpperCase()}`;
  // 0xRRGGBB
  m = s.match(/^0x([0-9A-Fa-f]{6})$/);
  if (m) return `#${m[1].toUpperCase()}`;
  // rgb(...) / rgba(...)
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

function colorFor(mode, line, sourceHex) {
  if (sourceHex) return sourceHex; // priorité à la couleur fournie
  const m = (mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro")       return METRO_COLORS[l.replace(/^0+/,"")] || DEFAULT_BY_MODE.metro;
  if (m === "rer")         return RER_COLORS[l] || DEFAULT_BY_MODE.rer;
  if (m === "tram")        return TRAM_COLORS[l.startsWith("T")?l:("T"+l)] || DEFAULT_BY_MODE.tram;
  if (m === "transilien")  return TRANSILIEN_COLORS[l] || DEFAULT_BY_MODE.transilien;
  if (m === "ter")         return DEFAULT_BY_MODE.ter;
  if (m === "tgv")         return DEFAULT_BY_MODE.tgv;
  return "#666";
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

    // mode
    let mode = modeKey(firstNonEmptyRow(r, ["mode","reseau","transport","mode_principal","network"]));
    const nameU = String(rawName || name).toUpperCase();
    const rawLine = firstNonEmptyRow(r, LINE_KEYS);
    const lineU = String(rawLine || "").toUpperCase();
    if (!mode) mode = guessModeFromContext(r, nameU, lineU) || null;
    if (!mode) continue; // ignore sans mode

    // ligne
    const line = extractLine(r, mode, rawLine, nameU);

    // couleur depuis la source (si fournie)
    // On prend la première couleur parseable parmi COLOR_KEYS
    let colorHex = null;
    for (const ck of COLOR_KEYS){
      const val = r[ck];
      const hex = parseHexColor(val);
      if (hex){ colorHex = hex; break; }
    }

    out.push({ name, mode, line, lat, lon, colorHex, _raw: DEBUG ? r : undefined });
  }

  if (DEBUG){
    const unresolved = out.filter(o => !o.line);
    const byMode = unresolved.reduce((acc, x) => {
      acc[x.mode] = (acc[x.mode] || 0) + 1;
      return acc;
    }, {});
    console.debug("[Stations][DEBUG] total:", out.length,
      "sans ligne:", unresolved.length, byMode, "Exemple:", unresolved.slice(0,8));
    window._stationsDebug = { all: out, unresolved };
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
    // markers
    for (const m of Object.keys(groups.markers)){
      const layer = groups.markers[m];
      const shouldShow = wanted.has(m) && layer.getLayers().length > 0;
      if (_map){
        if (shouldShow && !_map.hasLayer(layer)) layer.addTo(_map);
        if (!shouldShow && _map.hasLayer(layer)) _map.removeLayer(layer);
      }
    }
    // labels uniquement si zoom suffisant
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
    // reset
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

      // Marqueur coloré
      const mk = L.marker([row.lat, row.lon], { icon: iconFor(row) });
      mk.bindTooltip(tooltipHtml(row), { sticky: true, direction: "top" });
      mk.bindPopup(popupHtml(row));
      groups.markers[row.mode].addLayer(mk);

      // Étiquette permanente (nom + badge)
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

  // mise à jour des labels au zoom
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
