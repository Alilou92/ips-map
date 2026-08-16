// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Noms + couleurs corrects, étiquette permanente (zoom >= 13)

import { distanceMeters } from "./util.js?v=3";

// Bump si tu régénères data/stations.min.json
const DATA_VERSION = "24";

/* ───────── Libellés + couleurs ───────── */
const MODE_LABEL = {
  metro: "Métro",
  rer: "RER",
  transilien: "Transilien",
  ter: "TER",
  // le GTFS national ne sépare pas TGV et Intercités : les deux arrivent ici
  tgv: "TGV / Intercités",
  tram: "Tram",
};

// libellé court des pastilles, distinct du libellé descriptif ci-dessus
const BADGE_MODE = { ter: "TER", tgv: "TGV" };

/* Palette officielle IDFM (route_color du GTFS). Sert uniquement de secours :
   la couleur portée par la donnée prime — cf. colorFor(). */
const METRO_COLORS = {
  "1":"#FFBE00","2":"#0055C8","3":"#6E6E00","3BIS":"#82C8E6","4":"#A0006E",
  "5":"#FF5A00","6":"#82DC73","7":"#FF82B4","7BIS":"#82DC73","8":"#D282BE",
  "9":"#D2D200","10":"#DC9600","11":"#6E491E","12":"#00643C","13":"#82C8E6","14":"#640082"
};
const RER_COLORS = { A:"#EB2132", B:"#5091CB", C:"#FFCC30", D:"#008B5B", E:"#B94E9A" };
const TRAM_COLORS = {
  T1:"#0055C8",T2:"#A0006E","T3A":"#FF5A00","T3B":"#00643C",T4:"#DC9600",T5:"#640082",
  T6:"#FF0000",T7:"#6E491E",T8:"#6E6E00",T9:"#3C91DC",T10:"#6E6E00",T11:"#FF5A00",
  T12:"#A50034",T13:"#8D653D",T14:"#00A092",ORLYVAL:"#5EC5ED",CDGVAL:"#5CC5ED"
};
const TRANSILIEN_COLORS = { H:"#84653D", J:"#CEC73D", K:"#9B9842", L:"#C4A4CC", N:"#00B297", P:"#F58F53", R:"#F49FB3", U:"#B6134C" };

// Couleurs par mode quand la ligne est inconnue
const DEFAULT_BY_MODE = {
  metro: "#0055C8",
  rer: "#5091CB",
  tram: "#00A092",
  transilien: "#84653D",
  ter: "#0F4C5C",   // pétrole sombre — absent de la palette IDFM
  tgv: "#0A2A5E",   // marine profond — idem
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
  "colorHex","route_color","couleur","couleur_hex","couleur_ligne","color","hexa","hex","code_couleur","couleur_rgb"
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

/* La couleur de la donnée (route_color du GTFS IDFM) fait autorité : c'est la
   couleur officielle de la ligne, tenue à jour à chaque rebuild. Les tables
   ci-dessus ne servent que si la source n'en fournit pas. */
function colorFor(mode, line, sourceHex) {
  if (sourceHex) return sourceHex;

  const m = (mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro")      return METRO_COLORS[l.replace(/^0+/,"")] || DEFAULT_BY_MODE.metro;
  if (m === "rer")        return RER_COLORS[l] || DEFAULT_BY_MODE.rer;
  if (m === "tram")       return TRAM_COLORS[l.startsWith("T") || l.endsWith("VAL") ? l : ("T" + l)] || DEFAULT_BY_MODE.tram;
  if (m === "transilien") return TRANSILIEN_COLORS[l] || DEFAULT_BY_MODE.transilien;
  return DEFAULT_BY_MODE[m] || "#666";
}

/** "3BIS" -> "3bis", "T3A" -> "T3a", "CDGVAL" -> "CDGVAL" */
function lineLabel(line){
  const l = String(line || "").toUpperCase();
  if (!l) return "";
  if (l.endsWith("BIS")) return l.slice(0, -3) + "bis";
  if (/^T\d{1,2}[AB]$/.test(l)) return l.slice(0, -1) + l.slice(-1).toLowerCase();
  return l;
}

/** Noir ou blanc selon la luminance du fond (WCAG) — les lignes jaunes/vertes
    de la palette IDFM sont illisibles en blanc. */
function textOn(bg){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg || ""));
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126*lin((n>>16)&255) + 0.7152*lin((n>>8)&255) + 0.0722*lin(n&255);
  return L > 0.45 ? "#111" : "#fff";
}

function badgeText(mode, line){
  const m = (mode || "").toLowerCase();
  const l = lineLabel(line);
  if (m === "metro")      return l || "M";
  if (m === "rer")        return l ? `RER ${l}` : "RER";
  if (m === "tram")       return l || "T";
  if (m === "transilien") return l || "TN";
  return BADGE_MODE[m] || (MODE_LABEL[m] || m || "?").toUpperCase();
}

function iconFor(row) {
  const color = colorFor(row.mode, row.line, row.colorHex);
  const html = `<div style="width:14px;height:14px;border-radius:50%;background:${color};
    border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`;
  return L.divIcon({ className: "stn", html, iconSize: [18,18], iconAnchor: [9,9] });
}

/** " — Ligne 3bis" / " — RER A" / " — Tram 3a" — vide si la ligne est inconnue */
function lineSuffix(row){
  const l = lineLabel(row.line);
  if (!l) return "";
  if (row.mode === "metro")      return ` — Ligne ${l}`;
  if (row.mode === "rer")        return ` — RER ${l}`;
  if (row.mode === "tram")       return l.endsWith("VAL") ? ` — ${l}` : ` — Tram ${l.replace(/^T/i,"")}`;
  if (row.mode === "transilien") return ` — Ligne ${l}`;
  return "";
}

/** "Nanterre (92000)" — repère utile quand on ne connaît pas la région */
function localite(row){
  const c = row.commune ? String(row.commune).trim() : "";
  const cp = row.cp ? String(row.cp).trim() : "";
  if (c && cp) return `${c} (${cp})`;
  return c || cp || "";
}

function tooltipHtml(row){
  const color = colorFor(row.mode, row.line, row.colorHex);
  const btxt = badgeText(row.mode, row.line);
  const lieu = localite(row);
  return `<div class="station-tt">
    <span class="station-badge" style="background:${color};color:${textOn(color)}">${esc(btxt)}</span>
    <span class="station-name">${esc(row.name)}</span>
    <span style="opacity:.85">${esc(lineSuffix(row))}</span>
    ${lieu ? `<div class="station-loc">${esc(lieu)}</div>` : ""}
  </div>`;
}

function nameLabelHtml(row){
  const color = colorFor(row.mode, row.line, row.colorHex);
  const btxt = badgeText(row.mode, row.line);
  return `<span class="stn-badge" style="background:${color};color:${textOn(color)}">${esc(btxt)}</span>
          <span class="station-name">${esc(row.name)}</span>`;
}

function popupHtml(row){
  const mode = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();
  const color = colorFor(row.mode, row.line, row.colorHex);
  const detail = lineSuffix(row).replace(/^\s*—\s*/, "");
  const lieu = localite(row);
  // "RER — RER A" serait redondant : le détail suffit quand il reprend le mode
  const ligne1 = detail
    ? (detail.toUpperCase().startsWith(mode.toUpperCase()) ? detail : `${mode} — ${detail}`)
    : mode;
  return `<div><div style="font-weight:700;margin-bottom:.25rem">
    <span class="stn-badge" style="background:${color};color:${textOn(color)}">${esc(badgeText(row.mode, row.line))}</span>
    ${esc(row.name)}</div>
  <div style="opacity:.85">${esc(ligne1)}</div>
  ${lieu ? `<div style="opacity:.85">${esc(lieu)}</div>` : ""}</div>`;
}

/* ───────── extraction nom/ligne (fallback) ───────── */
const NAME_KEYS = [
  "name","nom","nom_gare","nomlong","nom_long","libelle","libelle_gare","label","intitule",
  "stop_name","nom_station","zdl_nom","nom_zdl","nom_commune","appellation","appellation_longue",
  "nom_de_la_gare","gare","station"
];
const CITY_KEYS = ["commune","ville","city","localite","locality","arrondissement","commune_principale"];
const CP_KEYS   = ["cp","code_postal","codepostal","postcode","postal_code","cp_gare"];

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

    // Format produit par scripts/build_stations.py : {name, mode, line, lat, lon, colorHex}
    // Tout est déjà normalisé (ligne officielle + route_color du GTFS) : on le prend
    // tel quel. Le ré-analyser perdait "7BIS", "11", "T3A"… et la couleur de ligne.
    if (r && typeof r.mode === "string" && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))
        && ("line" in r || "colorHex" in r)){
      const mode = modeKey(r.mode) || null;
      if (!mode) continue;
      out.push({
        name: String(r.name || "Gare"),
        mode,
        line: r.line != null && r.line !== "" ? String(r.line).toUpperCase() : null,
        lat: Number(r.lat),
        lon: Number(r.lon),
        colorHex: parseHexColor(r.colorHex) || null,
        commune: r.commune ? String(r.commune) : null,
        cp: r.cp ? String(r.cp) : null,
        dep: r.dep ? String(r.dep) : null
      });
      continue;
    }

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

    const cpRaw = firstNonEmptyRow(r, CP_KEYS);
    out.push({ name, mode, line, lat, lon, colorHex,
               commune: city ? String(city) : null,
               cp: cpRaw ? String(cpRaw) : null, dep: null });
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
