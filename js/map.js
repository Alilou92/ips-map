// js/map.js — Leaflet helpers (fond HTTPS + utilitaires)
import { round1 } from "./util.js?v=3";

/* ---------- fond de carte ---------- */
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* ---------- icônes et couleurs ---------- */
function colorForIps(ips) {
  if (!Number.isFinite(ips)) return "#9aa2ad";   // gris si IPS inconnu
  if (ips < 90)  return "#ef4444";               // rouge
  if (ips <= 110) return "#f59e0b";              // orange
  return "#10b981";                               // vert
}

function makeDot(color, size = 16, whiteRing = true) {
  const ring = whiteRing ? 'border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);' : '';
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;
                 background:${color};${ring}"></div>`;
  return L.divIcon({ className: "pin", html, iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

/* ---------- Exam helpers (Brevet / Bac général / Bac pro) ---------- */

// parse un nombre "92,5" / "92.5" / 92 -> 92.5
function num(x){
  if (x == null) return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Devine quel examen afficher pour l’établissement
function inferExamKind(f){
  const t = String(f.type || "").toLowerCase();
  if (t === "college") return "brevet";
  if (t === "lycee"){
    const hay = (f.appellation || f.libelle || f.nature || f.name || "").toLowerCase();
    // LP / professionnel / pro / LEP…
    if (/\b(professionnel|pro|lp|lep)\b/.test(hay)) return "bac_pro";
    return "bac_general";
  }
  return null;
}

/**
 * Récupère { current, previous, national } pour un kind ∈ {brevet|bac_general|bac_pro}
 * Accepté :
 *  - f.exam?.<kind> = { current, previous, national }
 *  - f.<kind>_rate / _prev / _nat
 *  - f.taux_<kind> / _n_1 / _nat
 */
function pickExamNumbers(f, kind){
  // 1) structure groupée
  const grp = f.exam && f.exam[kind];
  let cur = grp && num(grp.current);
  let prev = grp && num(grp.previous);
  let nat = grp && num(grp.national);

  // 2) variantes “à plat”
  const bases = {
    brevet:      ["brevet","dnb","taux_brevet"],
    bac_general: ["bac_general","bac_gen","taux_bac_general","bac"],
    bac_pro:     ["bac_pro","bacpro","taux_bac_pro"]
  }[kind];

  for (const b of (bases || [])){
    cur  ??= num(f[`${b}`]) ?? num(f[`${b}_rate`]) ?? num(f[`taux_${b}`]);
    prev ??= num(f[`${b}_prev`]) ?? num(f[`${b}_n_1`]) ?? num(f[`taux_${b}_n_1`]);
    nat  ??= num(f[`${b}_nat`]) ?? num(f[`moy_${b}_nat`]) ?? num(f[`national_${b}`]);
  }

  if (cur == null || prev == null || nat == null) return null;
  return { current: cur, previous: prev, national: nat };
}

/** HTML à insérer sous l’IPS (ou "" si données absentes) */
function examResultHtml(f){
  const kind = inferExamKind(f);
  if (!kind) return "";

  const data = pickExamNumbers(f, kind);
  if (!data) return "";

  const cur = data.current;
  const prev = data.previous;
  const nat = data.national;

  const delta = cur - prev;
  const aboveNat = cur >= nat;

  const colorMain = aboveNat ? "#10b981" : "#ef4444";   // vert / rouge
  const colorDiff = delta >= 0 ? "#10b981" : "#ef4444"; // vert / rouge
  const sign = delta >= 0 ? "+" : "−";

  const label =
    kind === "brevet"      ? "Brevet (taux de réussite)" :
    kind === "bac_general" ? "Bac général (taux de réussite)" :
                              "Bac pro (taux de réussite)";

  return `
    <div class="meta" style="margin-top:2px">
      <span>${label} :</span>
      <strong style="color:${colorMain}">${cur.toFixed(1)}%</strong>
      <span style="opacity:.8">— moy. nat. ${nat.toFixed(1)}%</span>
      <span style="margin-left:6px;color:${colorDiff}">${sign}${Math.abs(delta).toFixed(1)} pt vs N-1</span>
    </div>
  `;
}

/* ---------- exports ---------- */
export function initMap() {
  const map = L.map("map", {
    center: [48.8566, 2.3522],
    zoom: 12,
    zoomControl: true,
    preferCanvas: true
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR,
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);

  // couche unique pour les markers des établissements
  const markersLayer = L.layerGroup().addTo(map);

  return { map, markersLayer };
}

export function drawAddressCircle(map, lat, lon, radiusMeters) {
  const circle = L.circle([lat, lon], {
    radius: radiusMeters,
    color: "#60a5fa",
    weight: 2,
    fillColor: "#93c5fd",
    fillOpacity: 0.15
  }).addTo(map);
  return circle;
}

export function markerFor(f, ipsMap) {
  // f = { lat, lon, uai, type, name, commune, secteur, ...exam fields }
  const ips = ipsMap instanceof Map ? ipsMap.get(String(f.uai || "").toUpperCase()) : undefined;
  const col = colorForIps(ips);
  const icon = makeDot(col, 16);

  const m = L.marker([f.lat, f.lon], { icon });

  const typeHuman = f.type === "ecole" ? "École"
                   : f.type === "college" ? "Collège"
                   : f.type === "lycee" ? "Lycée" : "Établissement";

  const ipsTxt = Number.isFinite(ips) ? round1(ips).toFixed(1) : "—";
  const sec = f.secteur ?? "—";
  const commune = f.commune ? ` — ${f.commune}` : "";

  // nouvelle ligne “examens”
  const examLine = examResultHtml(f);

  m.bindPopup(
    `<div style="line-height:1.35">
      <div style="font-weight:700;margin-bottom:.25rem">${typeHuman}${commune}</div>
      <div>${(f.name ?? "").toString()}</div>
      <div style="opacity:.85">IPS : <strong>${ipsTxt}</strong> • Secteur : ${sec} • UAI : ${f.uai ?? "—"}</div>
      ${examLine}
    </div>`
  );

  return m;
}

export function fitToMarkers(map, items) {
  const coords = (items || [])
    .map(x => (Array.isArray(x) ? x : [x.lat, x.lon]))
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!coords.length) return;
  const b = L.latLngBounds(coords.map(([la, lo]) => L.latLng(la, lo)));
  try { map.fitBounds(b.pad(0.15), { animate: true }); } catch {}
}

export default { initMap, drawAddressCircle, markerFor, fitToMarkers };
