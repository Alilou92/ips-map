// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Noms + couleurs corrects, étiquette permanente (zoom >= 13)

import { distanceMeters } from "./util.js?v=3";

// Bump si tu régénères data/stations.min.json
const DATA_VERSION = "19";

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

// ⚙️ Normalisation front : corriger les combos improbables venant du JSON
function normalizeRow(row){
  let mode = String(row.mode || "").toLowerCase();
  let line = row.line != null ? String(row.line).toUpperCase().trim() : null;

  // 3bis / 7bis → forme canonique
  if (mode === "metro" && line){
    if (/^\s*3\s*BIS\s*$/i.test(line)) line = "3BIS";
    if (/^\s*7\s*BIS\s*$/i.test(line)) line = "7BIS";
    line = line.replace(/^0+/, ""); // "01" -> "1"
  }

  // Si le build aurait classé "transilien" mais la ligne ressemble à RER (A-E),
  // on recatégorise ici en RER (ceinture + bretelles).
  if (mode === "transilien" && /^[A-E]$/.test(line || "")){
    mode = "rer";
  }

  return {
    name: row.name,
    mode,
    line,
    lat: row.lat,
    lon: row.lon,
    colorHex: row.colorHex || null
  };
}

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

function colorFor(mode, line, sourceHex) {
  if (sourceHex) return sourceHex; // priorité à la couleur fournie depuis le GTFS
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

/* ───────── chargement JSON ───────── */
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

  // Normalisation front (corrige RER vs TN + diverses menues formes)
  const out = rawRows.map(row => normalizeRow(row));
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

    for (const raw of all){
      const row = normalizeRow(raw); // sécurité, au cas où
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
