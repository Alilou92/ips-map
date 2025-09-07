// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Noms + couleurs + lignes déduits de façon robuste (case-insensitive, scan global)

import { distanceMeters } from "./util.js?v=3";

// Bump si tu régénères data/stations.min.json
const DATA_VERSION = "18";

// Debug & options via querystring
const QS = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const DEBUG = !!(QS && QS.has("debugStations"));
const FORCE_LABELS = !!(QS && QS.has("forceStationLabels"));
const ZOOM_LABELS = FORCE_LABELS ? 0 : 13;

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
const DEFAULT_BY_MODE = { metro:"#1D87C9", rer:"#0072BC", tram:"#00A36D", transilien:"#2E3192", ter:"#0A74DA", tgv:"#A1006B" };

/* ───────── helpers génériques ───────── */
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

// aplatit properties + sous-objets utiles
function flatten(o){
  if (!o || typeof o !== "object") return o || {};
  let base = o;
  if (o.properties && typeof o.properties === "object") base = { ...o.properties, ...o };
  const out = { ...base };
  for (const key of ["route","ligne","line","network","reseau"]) {
    const v = base[key];
    if (v && typeof v === "object") Object.assign(out, v);
  }
  return out;
}

// récupère une valeur en insensible à la casse + alias multiples
function getCI(obj, aliases){
  if (!obj) return null;
  const keys = Object.keys(obj);
  for (const a of aliases){
    const al = a.toLowerCase();
    const k = keys.find(k => k.toLowerCase() === al);
    if (k && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

// scanne récursivement toutes les chaînes de l’objet (limité à 2 niveaux pour rester sûr)
function scanStrings(obj, depth=0, seen = new Set()){
  if (!obj || depth > 2) return [];
  const out = [];
  if (Array.isArray(obj)){
    for (const v of obj){
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object") out.push(...scanStrings(v, depth+1, seen));
    }
  } else if (typeof obj === "object"){
    for (const [k,v] of Object.entries(obj)){
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object" && !seen.has(v)) { seen.add(v); out.push(...scanStrings(v, depth+1, seen)); }
    }
  }
  return out;
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
  let m = S.match(/\bRER\s*([A-E])\b/);                if (m) return m[1];
  if (mode === "metro") {
    m = S.match(/\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b/); if (m) return m[1];
    m = S.match(/\b([37])\s*BIS\b/);                          if (m) return m[1]==="3"?"3BIS":"7BIS";
  }
  if (mode === "tram") {
    m = S.match(/\bT\s*([0-9]{1,2}[AB]?)\b/);                 if (m) return `T${m[1]}`;
    m = S.match(/\bTRAM\s*([0-9]{1,2}[AB]?)\b/);              if (m) return `T${m[1]}`;
  }
  if (mode === "transilien") {
    m = S.match(/\b(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b/);   if (m) return m[1];
    m = S.match(/\b([HJKLNRPU])\b/);                          if (m) return m[1];
  }
  return null;
}

/* Couleurs depuis la donnée source */
const COLOR_KEYS = [
  "route_color","couleur","couleur_hex","couleur_ligne","color","hexa","hex","code_couleur","couleur_rgb",
  "routeColour","route_color_hex","color_hex","couleurRVB","rgb","rgb_color"
];
function parseHexColor(x){
  if (x == null) return null;
  const s = String(x).trim();
  let m = s.match(/^#?([0-9A-Fa-f]{6})$/); if (m) return `#${m[1].toUpperCase()}`;
  m = s.match(/^0x([0-9A-Fa-f]{6})$/);     if (m) return `#${m[1].toUpperCase()}`;
  m = s.match(/^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (m){
    const to2 = n => Math.max(0,Math.min(255,Number(n))).toString(16).toUpperCase().padStart(2,"0");
    return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
  }
  return null;
}

function colorFor(mode, line, sourceHex) {
  if (sourceHex) return sourceHex;
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

/* ───────── Clés connues ───────── */
const NAME_KEYS = [
  "name","nom","nom_gare","nomlong","nom_long","libelle","libelle_gare","label","intitule",
  "stop_name","nom_station","zdl_nom","nom_zdl","nom_commune","appellation","appellation_longue",
  "nom_de_la_gare","gare","station","designation","denomination","denom"
];
const CITY_KEYS = ["commune","ville","city","localite","locality","arrondissement","commune_principale"];
const LINE_KEYS = [
  "line","ligne","nom_ligne","code_ligne","ligne_long","ligne_nom","ligne_code",
  "indice_ligne","indice_lig",
  "route_short_name","route_id","route_code","routeName","routeCode","route",
  "id_ligne","id_ref_ligne","reseau_ligne","libelle_ligne","num_ligne","numero_ligne","ligne_numero","ligne_indice",
  "letter","lettre","ligne_rer","ligne_metro","ligne_tram","network_line"
];

/* ───────── Déduction robuste nom/ligne/couleur ───────── */
function guessModeFromContext(row, nameU, lineU){
  if (/\bRER\s*[A-E]?\b/.test(nameU) || /\bRER\s*[A-E]?\b/.test(lineU)) return "rer";
  if (/\b(?:M|MÉTRO|METRO)\s*\d{1,2}\b/.test(nameU) || /\bMETRO\b/.test(lineU)) return "metro";
  if (/\bT\s*\d{1,2}[AB]?\b/.test(nameU) || /\bTRAM\b/.test(lineU)) return "tram";
  const isSncf = ("uic" in row) || ("code_ligne" in row) || ("codeuic" in row) || ("voyageurs" in row) || ("sncf" in row);
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
    let m = nameU.match(/\b(?:M|MÉTRO|METRO)\s*([0-9]{1,2})\b/); if (m) return m[1];
    m = nameU.match(/\b([37])\s*BIS\b/); if (m) return m[1]==="3"?"3BIS":"7BIS";
  }
  if (mode === "tram"){ const m = nameU.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1].toUpperCase()}`; }
  if (mode === "transilien"){ const m = nameU.match(/\b([HJKLNRPU])\b/); if (m) return m[1]; }
  // 🔁 scan global des chaînes si rien trouvé
  const all = scanStrings(row).map(s => String(s).toUpperCase());
  for (const s of all){
    const c = normalizeLine(s, mode);
    if (c) return c;
  }
  return null;
}

function extractName(row){
  // 1) clés connues (CI)
  let raw = getCI(row, NAME_KEYS);
  // 2) fallback : stop / station imbriqué
  if (!raw){
    const stop = getCI(row, ["stop","station","gare","zdl","zdl_nom"]);
    if (stop && typeof stop === "object") raw = getCI(stop, NAME_KEYS);
  }
  // 3) scan global des strings, prend une chaîne "propre" (contient une lettre, pas juste un code)
  if (!raw){
    const strings = scanStrings(row);
    raw = strings.find(s => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(s) && s.length >= 3 && !/^[A-Z0-9_\-]{2,}$/.test(s));
  }
  let name = cleanName(raw);
  if (!name){
    // si on voit un motif "Ligne …" ou "RER X" dans le nom brut, on coupe
    const m = String(raw||"").replace(/\s+/g," ").trim().replace(/^Gare\s+/i,"");
    name = m;
  }
  return name || "Gare";
}

function extractColor(row){
  let colRaw = getCI(row, COLOR_KEYS);
  if (!colRaw){
    // scan global
    const strings = scanStrings(row);
    for (const s of strings){
      const c = parseHexColor(s);
      if (c) { colRaw = c; break; }
    }
  }
  return parseHexColor(colRaw);
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
      else if (json && Array.isArray(json.features)) rawRows = json.features;
      if (rawRows.length){ if (DEBUG) console.debug(`[Stations] chargées: ${rawRows.length} via ${url}`); break; }
    }catch{}
  }

  const out = [];
  for (const r0 of rawRows){
    const r = flatten(r0);

    // coords
    let lat = Number(getCI(r, ["lat","latitude"]));
    let lon = Number(getCI(r, ["lon","lng","longitude"]));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)){
      const g = r0 && r0.geometry && Array.isArray(r0.geometry.coordinates) ? r0.geometry.coordinates : null;
      if (g && g.length >= 2){ lon = Number(g[0]); lat = Number(g[1]); }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // nom
    const name = extractName(r);

    // mode
    let mode = modeKey(getCI(r, ["mode","reseau","transport","mode_principal","network","type_transport"]));
    const stringsU = scanStrings(r).map(x => String(x).toUpperCase());
    const joined = stringsU.join(" • ");
    if (!mode) mode = guessModeFromContext(r, joined, joined) || null;
    if (!mode) continue;

    // ligne
    const rawLine = getCI(r, LINE_KEYS);
    const line = extractLine(r, mode, rawLine, joined);

    // couleur
    const colorHex = extractColor(r);

    if (DEBUG && (!line || !colorHex || name === "Gare")){
      const peek = {};
      for (const k of [...NAME_KEYS, ...LINE_KEYS, ...COLOR_KEYS, "mode","reseau","transport","network"]) {
        const v = getCI(r,[k]);
        if (v != null) peek[k] = v;
      }
      console.debug("[stations] Incomplet:", { name, mode, line, hasColor: !!colorHex, sample: peek });
    }

    out.push({ name, mode, line, lat, lon, colorHex });
  }

  _rowsCache = out;
  if (DEBUG) console.debug(`[Stations] prêtes: ${out.length}`);
  return _rowsCache;
}

/* ───────── contrôleur ───────── */
export function makeStationsController({ map } = {}){
  const _map = map || null;

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
