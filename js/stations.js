// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)

// NOTE: augmente la version à chaque modif pour casser le cache
const DATA_VERSION = "8";

import { distanceMeters } from "./util.js";

/* ───────────────────── Libellés ───────────────────── */

const MODE_LABEL = {
  metro: "Métro",
  rer: "RER",
  transilien: "Transilien",
  ter: "TER",
  tgv: "TGV",
  tram: "Tram",
};

/* ───────────────────── Couleurs ───────────────────── */

const METRO_COLORS = {
  "1":"#FFCD00","2":"#1D87C9","3":"#9FCE66","3BIS":"#84C28E","4":"#A0006E",
  "5":"#F28E00","6":"#76C696","7":"#F59CB2","7BIS":"#89C8C5","8":"#CE64A6",
  "9":"#B0BD00","10":"#D6C178","11":"#704B1C","12":"#007852","13":"#99B4CB","14":"#662483"
};
const RER_COLORS = { A:"#E11E2B", B:"#0072BC", C:"#F6A800", D:"#2E7D32", E:"#8E44AD" };
const TRAM_COLORS = {
  T1:"#6F6F6F",T2:"#0096D7",T3:"#C77DB3","T3A":"#C77DB3","T3B":"#C77DB3",
  T4:"#5BC2E7",T5:"#A9CC51",T6:"#00A36D",T7:"#E98300",T8:"#B1B3B3",
  T9:"#C1002A",T10:"#6E4C9A",T11:"#575756",T12:"#0077C8",T13:"#008D36"
};
const TRANSILIEN_COLORS = { H:"#0064B0", J:"#9D2763", L:"#5C4E9B", N:"#00936E", P:"#E2001A", U:"#6F2C91", K:"#2E3192", R:"#00A4A7" };

// Couleur de **secours** par mode (si la ligne est inconnue)
const MODE_FALLBACK_COLOR = {
  metro: "#1E90FF",
  rer: "#111111",
  tram: "#2c8b2c",
  transilien: "#2c8b2c",
  ter: "#8aa55a",
  tgv: "#b03a9b",
};

// util HTML
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* ───────────────────── Normalisation ───────────────────── */

function modeKey(m) {
  const s = String(m || "").normalize("NFKD").replace(/\p{Diacritic}/gu,"").toLowerCase().trim();
  if (!s) return null;
  if (s.startsWith("met")) return "metro";
  if (s === "rer" || s.includes(" rer")) return "rer";
  if (s.includes("transilien") || /\btrain(?!\s*à grande vitesse)\b/.test(s)) return "transilien";
  if (s.includes("tram") || /^t\d/i.test(s)) return "tram";
  if (/\btgv\b|grande\s*vitesse|lgv/.test(s)) return "tgv";
  if (/\bter\b/.test(s)) return "ter";
  return null;
}

// Essaie de déduire un code ligne à partir d'un texte
function normalizeLine(raw, mode) {
  const S = String(raw ?? "").toUpperCase().trim();
  if (!S) return null;

  // RER A..E
  let m = S.match(/\bRER\s*([A-E])\b/);
  if (m) return m[1];

  if (mode === "metro") {
    // "M8" / "METRO 8" / "LIGNE 08" / "8" / "03BIS"
    m = S.match(/\bM(?:ETRO|ÉTRO)?\s*0?(\d{1,2})(?:\s*BIS)?\b/);
    if (m) return m[1];
    m = S.match(/\b(?:LIGNE|METRO|MÉTRO)\s*0?(\d{1,2})(?:\s*BIS)?\b/);
    if (m) return m[1];
    m = S.match(/\b0?(\d{1,2})(?:\s*BIS)?\b/);
    if (m) return m[1];
  }

  if (mode === "tram") {
    // "T 9" / "TRAM 3B" / "T3A"
    m = S.match(/\bT\s*([0-9]{1,2}\s*[AB]?)\b/);
    if (m) return "T" + m[1].replace(/\s+/g,"");
    m = S.match(/\bTRAM\s*([0-9]{1,2}\s*[AB]?)\b/);
    if (m) return "T" + m[1].replace(/\s+/g,"");
  }

  if (mode === "transilien") {
    // "Ligne J" / "Transilien L" / "J"
    m = S.match(/\bTRANSILIEN\s+([A-Z]{1,2}\d?)\b/);
    if (m) return m[1];
    m = S.match(/\bLIGNE\s+([A-Z]{1,2}\d?)\b/);
    if (m) return m[1];
    m = S.match(/\b([A-Z]{1,2}\d?)\b/);
    if (m && m[1].length <= 2) return m[1];
  }

  // Derniers recours génériques
  m = S.match(/\b([A-Z]{1,2}\d?)\b/);
  if (m) return m[1];
  m = S.match(/\b([0-9]{1,2})\b/);
  if (m) return m[1];

  return null;
}

function colorFor(mode, line) {
  const m = String(mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();

  if (m === "metro") {
    const key = l.replace(/^0+/,"").toUpperCase();
    return METRO_COLORS[key] || MODE_FALLBACK_COLOR.metro;
  }
  if (m === "rer")   return RER_COLORS[l] || MODE_FALLBACK_COLOR.rer;
  if (m === "tram")  return TRAM_COLORS[l.startsWith("T") ? l : ("T"+l)] || MODE_FALLBACK_COLOR.tram;
  if (m === "transilien") return TRANSILIEN_COLORS[l] || MODE_FALLBACK_COLOR.transilien;
  if (m === "tgv")   return MODE_FALLBACK_COLOR.tgv;
  if (m === "ter")   return MODE_FALLBACK_COLOR.ter;
  return "#666";
}

function badgeText(mode, line) {
  const m = String(mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro") return l || "M";
  if (m === "rer") return `RER ${l || ""}`.trim();
  if (m === "tram") return l || "T";
  if (m === "transilien") return l || "TN";
  return (MODE_LABEL[m] || m || "?").toUpperCase();
}

/* ───────────────────── Rendu icône / infobulles ───────────────────── */

function iconFor(mode, line) {
  const color = colorFor(mode, line);
  const html = `
    <div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};
      border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.35);
    "></div>`;
  return L.divIcon({
    className: "stn",
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function tooltipHtml(row) {
  const color = colorFor(row.mode, row.line);
  const btxt  = badgeText(row.mode, row.line);
  const mode  = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();

  let suffix = "";
  if (row.mode === "metro" && row.line) suffix = ` — Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line) suffix = ` — RER ${row.line}`;
  else if (row.mode === "tram" && row.line) suffix = ` — Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.line) suffix = ` — ${row.line}`;

  return `
    <div style="display:flex;align-items:center;gap:.5rem;line-height:1.2;">
      <span style="
        display:inline-block;min-width:1.8em;padding:.1em .45em;border-radius:1em;
        background:${color};color:#fff;font-weight:700;font-size:.85em;text-align:center;
      ">${esc(btxt)}</span>
      <span style="font-weight:600">${esc(row.name)}</span>
      <span style="opacity:.85">${esc(suffix)}</span>
    </div>
  `;
}

function popupHtml(row) {
  const mode = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();
  let linePart = "";
  if (row.mode === "metro" && row.line)      linePart = `Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line)   linePart = `RER ${row.line}`;
  else if (row.mode === "tram" && row.line)  linePart = `Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.line)                         linePart = row.line;

  return `
    <div>
      <div style="font-weight:700;margin-bottom:.25rem">${esc(row.name)}${linePart ? " — " + esc(linePart) : ""}</div>
      <div style="opacity:.85">${esc(mode)}</div>
    </div>
  `;
}

/* ───────────────────── Chargement des données ───────────────────── */

let _loaded = null;

async function loadOnce() {
  if (_loaded) return _loaded;

  const urls = [
    `./data/stations.min.json?v=${DATA_VERSION}`,
    `./data/stations.min.json`,
  ];

  let rows = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const raw = await res.json();
      rows = Array.isArray(raw) ? raw : [];
      if (rows.length) {
        console.debug(`[Stations] chargées: ${rows.length} (via ${url})`);
        break;
      }
    } catch {}
  }

  const out = [];
  for (const r of rows) {
    // essaye plusieurs champs possibles
    const rawMode =
      r.mode ?? r.reseau ?? r.transport ?? r.mode_principal ?? r.modePrincipal ?? r.type_mode ?? r.type;
    const mode = modeKey(rawMode);

    // si pas de mode, tente d'inférer depuis la ligne / texte
    let lineRaw =
      r.line ?? r.ligne ?? r.code_ligne ?? r.codeLigne ?? r.nom_ligne ?? r.ligne_long ??
      r.ligne_code ?? r.ligne_short ?? r.ligne_num ?? r.code ?? r.route_short_name ?? r.route_id ?? "";

    // parfois un tableau de lignes (on prend la première)
    if (!lineRaw && Array.isArray(r.lines) && r.lines.length) {
      lineRaw = r.lines[0].code ?? r.lines[0].name ?? r.lines[0].id ?? r.lines[0];
    }

    const name = String(r.name ?? r.nom ?? r.label ?? r.gare ?? "Gare").trim();
    const type = String(r.type ?? r.typologie ?? (mode === "metro" || mode === "tram" ? "Station" : "Gare")).trim();
    const lat = Number(r.lat ?? r.latitude ?? r.lat_wgs84 ?? r.y);
    const lon = Number(r.lon ?? r.longitude ?? r.lon_wgs84 ?? r.x);

    const line = normalizeLine(lineRaw, mode);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !mode) continue;
    out.push({ name, type, mode, line, lat, lon });
  }

  _loaded = out;
  console.debug(`[Stations] prêtes: ${_loaded.length}`);
  return _loaded;
}

/* ───────────────────── Factory contrôleur ───────────────────── */

export function makeStationsController({ map } = {}) {
  const _map = map || null;

  const groups = {
    metro: L.layerGroup(),
    rer: L.layerGroup(),
    transilien: L.layerGroup(),
    ter: L.layerGroup(),
    tgv: L.layerGroup(),
    tram: L.layerGroup(),
  };
  let allStations = [];

  function clearGroups() {
    for (const k of Object.keys(groups)) {
      groups[k].clearLayers();
      if (_map && _map.hasLayer(groups[k])) _map.removeLayer(groups[k]);
    }
  }

  function addMarkersFor({ modesWanted, center, radiusMeters } = {}) {
    const wanted = modesWanted instanceof Set
      ? modesWanted
      : new Set(["metro", "rer", "transilien", "ter", "tgv", "tram"]);

    clearGroups();

    const useRadius = Array.isArray(center)
      && Number.isFinite(radiusMeters) && radiusMeters > 0;

    for (const row of allStations) {
      if (!wanted.has(row.mode)) continue;

      if (useRadius) {
        const d = distanceMeters(center[0], center[1], row.lat, row.lon);
        if (d > radiusMeters) continue;
      }

      const mk = L.marker([row.lat, row.lon], { icon: iconFor(row.mode, row.line) });
      mk.bindTooltip(tooltipHtml(row), { sticky: true, direction: "top" });
      mk.bindPopup(popupHtml(row));
      groups[row.mode].addLayer(mk);
    }

    if (_map) {
      for (const m of Object.keys(groups)) {
        if (wanted.has(m) && groups[m].getLayers().length > 0) {
          groups[m].addTo(_map);
        }
      }
    }
  }

  return {
    async ensure({ modesWanted, center, radiusMeters } = {}) {
      if (!allStations.length) {
        allStations = await loadOnce(); // peut être vide si pas de fichier
      }
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    refresh({ modesWanted, center, radiusMeters } = {}) {
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    clear() {
      clearGroups();
    },
  };
}

export default makeStationsController;
