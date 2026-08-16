// js/app.js — recherche + filtres + stations IDFM/SNCF
import Store from "./store.js?v=27";
import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js?v=5";
import { geocode } from "./geocode.js?v=3";
import { renderList, setCount, showErr, showInfo, clearErr, clearList, renderSecteur, clearSecteur } from "./ui.js?v=6";
import { collegeDeSecteur } from "./secteur.js?v=2";
import { makeStationsController } from "./stations.js?v=22";
import { DEPT_BY_NAME, DEPT_NAME_BY_CODE, AMBIGUOUS_DEPT_NAMES } from "./departements.js?v=1";

/* helpers */
const DEPT_RE = /^(?:0?[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/i;
function normDept(q){
  let s = String(q).trim().toUpperCase();
  if (s === "2A" || s === "2B") return s;
  if (/^\d{1,2}$/.test(s)) return s.padStart(2,"0");
  if (/^97[1-6]$/.test(s)) return s;
  return s;
}

/** normalise un libellé : sans accents, minuscules, tirets/apostrophes -> espaces */
function normLabel(s){
  return String(s ?? "")
    .normalize("NFKD").replace(/\p{Diacritic}/gu,"")
    .toLowerCase()
    .replace(/[’'\-_]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

/**
 * Renvoie le code département si la saisie en désigne un, sinon null.
 * - "94", "2A", "971"                      -> code
 * - "Val-de-Marne", "Seine Saint Denis"    -> code (noms non ambigus)
 * - "département Vienne", "dep 86"         -> code (force le mode département)
 * Les noms qui sont aussi des communes (Vienne, Loire, Mayenne…) ne basculent
 * en mode département que s’ils sont préfixés par "département/dept/dep".
 */
function deptFromQuery(q){
  const raw = String(q || "").trim();
  if (!raw) return null;
  if (DEPT_RE.test(raw)) return normDept(raw);

  const forced = /^(?:departements?|dept|dep)\s+(.+)$/.exec(normLabel(raw));
  const key = forced ? forced[1] : normLabel(raw);
  if (!key) return null;

  if (forced && DEPT_RE.test(key.toUpperCase())) return normDept(key);

  const code = DEPT_BY_NAME[key];
  if (!code) return null;
  if (!forced && AMBIGUOUS_DEPT_NAMES.has(key)) return null; // "Vienne" = commune par défaut
  return code;
}
/** Rayons proposés, en km. Le plus grand sert aussi à décider quels
    départements précharger : une recherche de 5 km peut déborder sur deux
    départements voisins, il ne faut pas les manquer. */
const RAYONS_KM = [1, 2, 3, 5];
const RAYON_MAX_M = Math.max(...RAYONS_KM) * 1000;

function normalizeSectorFromSelect(raw){
  const s = String(raw||"").normalize("NFKD").replace(/\p{Diacritic}/gu,"").toLowerCase().trim();
  if (!s || raw === "all") return "all";
  if (s.startsWith("pub")) return "Public";
  if (s.startsWith("pri")) return "Privé";
  return "all";
}

/* map + stations controller */
const { map, markersLayer } = initMap();
const Stations = makeStationsController({ map });

/* ───────── Redimensionnement : la hauteur vient du CSS, on resynchronise Leaflet ───────── */
window._leafletMap = map;
let _resizeRaf = 0;
function syncMapSize() {
  if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = 0;
    try { map.invalidateSize({ animate: false }); } catch {}
  });
}
window.addEventListener('resize', syncMapSize, { passive: true });
window.addEventListener('orientationchange', syncMapSize, { passive: true });
// la barre du haut peut passer sur 2 lignes (wrap) : on suit sa hauteur réelle
if (typeof ResizeObserver !== "undefined") {
  const topEl = document.querySelector('.top');
  if (topEl) new ResizeObserver(syncMapSize).observe(topEl);
}
syncMapSize();

/* ───────── Résolution adresse/ville/CP -> point ───────── */
async function resolvePoint(q){
  const s = String(q || "").trim();

  // La BAN résout adresses, communes ET codes postaux, et renvoie le code INSEE
  // dont dépend la carte scolaire : on la sollicite en premier. Le répertoire
  // local ne sert plus que de secours, et n'est donc plus chargé d'office.
  try {
    const g = await geocode(s);
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) return g;
  } catch { /* on tente le répertoire local */ }

  await Store.loadGazetteer();
  if (/^\d{5}$/.test(s)){
    const cand = Store.gazetteer.find(c => Array.isArray(c.cps) && c.cps.includes(s));
    if (cand) return { lat: cand.lat, lon: cand.lon, label: `${cand.name} (${s})` };
  }
  const city = Store.findCommune(s);
  if (city) return { lat: city.lat, lon: city.lon, label: city.name };

  throw new Error("Adresse introuvable");
}

/* ───────── État recherches ───────── */
let addrCircle = null;
let addrLat = null, addrLon = null;
let lastRadiusMeters = 0;

/* cases à cocher pour les modes */
const MODE_IDS = {
  metro: "st_metro",
  rer: "st_rer",
  tram: "st_tram",
  transilien: "st_transilien",
  ter: "st_ter",
  tgv: "st_tgv",
};
function getModesWanted(){
  const s = new Set();
  for (const [mode, id] of Object.entries(MODE_IDS)){
    const el = document.getElementById(id);
    if (el && el.checked) s.add(mode);
  }
  return s;
}
function refreshStations(){
  if (addrLat == null || addrLon == null) return;
  if (!Number.isFinite(lastRadiusMeters) || lastRadiusMeters <= 0) return;
  Stations.refresh({
    modesWanted: getModesWanted(),
    center: [addrLat, addrLon],
    radiusMeters: lastRadiusMeters
  });
}

/* dept top 10 */
async function runDeptRankingLocal(depInput, sectorFilter, typesWanted) {
  const dep = normDept(depInput);
  await Store.loadDeps([dep]);

  Stations.clear();
  clearSecteur();
  addrLat = null; addrLon = null; lastRadiusMeters = 0;

  const top = Store.top10ByDept(dep, typesWanted, sectorFilter);

  const list  = document.getElementById('list');
  list.innerHTML = "";
  const depLabel = DEPT_NAME_BY_CODE[dep] ? `${dep} – ${DEPT_NAME_BY_CODE[dep]}` : dep;
  setCount(`Top 10 — Département ${depLabel} (${sectorFilter==="all"?"Tous secteurs":sectorFilter})`);

  markersLayer.clearLayers();
  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }

  const order = ["ecole","college","lycee"].filter(t => typesWanted.has(t));
  let anyMarker = false;

  for (const t of order){
    const human = t==="ecole" ? "Écoles" : t==="college" ? "Collèges" : "Lycées";
    const arr = top[t] || [];

    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sectionTitle">${human} — Top 10 <span class="pill small">${dep}</span></div>`;

    arr.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = "item";
      row.innerHTML = `
        <div class="name">#${i+1} ${it.name}<span class="badge">${it.secteur ?? "—"}</span></div>
        <div class="meta">${human.slice(0,-1)} — ${it.commune || ""}</div>
        <div class="meta">IPS : ${Number(it.ips).toFixed(1)} • UAI : ${it.uai}</div>`;
      if (it.lat && it.lon){
        const m = markerFor({ ...it, type:t }, new Map([[it.uai, it.ips]]), Store.examsFor(it.uai), Store.examsMeta);
        m.addTo(markersLayer);
        anyMarker = true;
        row.addEventListener('click', ()=> map.setView([it.lat,it.lon], 16));
      }
      sec.appendChild(row);
    });

    if (!arr.length){
      const empty = document.createElement('div');
      empty.className = "small";
      empty.style.margin = "6px 0 12px";
      empty.textContent = "Aucun établissement avec IPS publié dans cette catégorie.";
      sec.appendChild(empty);
    }

    list.appendChild(sec);
  }

  const all = order.flatMap(t => top[t] || []).filter(x => x.lat && x.lon);
  if (anyMarker && all.length) fitToMarkers(map, all);
  else if (order.some(t => (top[t] || []).length)) showInfo("Top 10 listé (peu de coordonnées disponibles pour la carte).");
  else showInfo(`Aucun établissement avec IPS publié pour le département ${depLabel}.`);
}

/* autour d’une adresse/ville/CP */
async function runAround(q, radiusKm, sectorFilter, typesWanted){
  await Store.load();

  const { lat, lon, label, address } = await resolvePoint(q);
  addrLat = lat; addrLon = lon;
  clearSecteur();

  // Charge les départements que le cercle recoupe — 3 km étant le rayon maximal
  // que la recherche peut tenter, on couvre d'un coup les élargissements.
  await Store.loadDeps(Store.depsForCircle(lat, lon, RAYON_MAX_M));

  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }
  addrCircle = drawAddressCircle(map, lat, lon, radiusKm * 1000);

  markersLayer.clearLayers();

  let items = Store.around(lat, lon, radiusKm * 1000, sectorFilter, typesWanted);

  // élargit tant que rien ne sort, jusqu'au plus grand rayon proposé
  let triedKm = radiusKm;
  for (const km of RAYONS_KM){
    if (items.length || km <= radiusKm) continue;
    triedKm = km;
    map.removeLayer(addrCircle);
    addrCircle = drawAddressCircle(map, lat, lon, km * 1000);
    items = Store.around(lat, lon, km * 1000, sectorFilter, typesWanted);
  }

  // mémorise le rayon pour les stations
  lastRadiusMeters = triedKm * 1000;

  const src = L.marker([lat, lon], {
    icon: L.divIcon({ className: 'src', html: '<div class="src-pin">A</div>' })
  }).bindPopup(`<strong>Adresse/ville</strong><div>${label}</div>`).addTo(markersLayer);

  // affiche les transports dans la zone, même si aucun établissement
  await Stations.ensure({
    modesWanted: getModesWanted(),
    center: [lat, lon],
    radiusMeters: lastRadiusMeters
  });

  if (!items.length){
    setCount("0 établissement trouvé");
    clearList("Aucun résultat pour cette zone.");
    showInfo(`Aucun établissement dans ${triedKm} km autour de « ${label} ». Essaie d’augmenter le rayon ou d’élargir les filtres.`);
    map.setView([lat, lon], triedKm >= 5 ? 12 : triedKm >= 2 ? 13 : 15);
    src.openPopup();
    return;
  }

  const markersByUai = new Map();
  items.forEach(f => {
    const m = markerFor(f, Store.ipsMap, Store.examsFor(f.uai), Store.examsMeta);
    m.addTo(markersLayer);
    markersByUai.set(f.uai, m);
  });

  items.sort((a,b)=> (a.distance??1e12) - (b.distance??1e12));
  setCount(`${items.length} établissement${items.length>1?"s":""} dans ${triedKm} km — ${sectorFilter==="all"?"Tous secteurs":sectorFilter}`);
  renderList({ items, ipsMap: Store.ipsMap, markersByUai, map,
               examsMap: Store.examsMap, examsMeta: Store.examsMeta });

  fitToMarkers(map, items.concat([{lat, lon}]));
  src.openPopup();

  await showSecteur(address, label);
}

/** Collège de secteur : seule une vraie adresse permet de le déterminer */
async function showSecteur(address, label){
  if (!address || !address.citycode) return;
  let res = null;
  try { res = await collegeDeSecteur(address); }
  catch (e) { console.warn("[Secteur] indisponible :", e.message); return; }
  if (!res) return;

  const etab = res.uai ? Store.establishments.find(e => e.uai === res.uai) : null;
  const choix = Array.isArray(res.choix)
    ? res.choix.map(u => Store.establishments.find(e => e.uai === u) || { uai: u })
    : null;
  renderSecteur({
    res, etab, label, choix,
    ips: etab ? Store.ipsMap.get(etab.uai) : null,
    exams: etab ? Store.examsFor(etab.uai) : null,
    examsMeta: Store.examsMeta,
    onClick: etab ? () => map.setView([etab.lat, etab.lon], 16) : null
  });
}

/* contrôleur */
let _searchToken = 0;   // ignore les résultats d’une recherche périmée

async function runSearch(){
  clearErr();
  const q = document.getElementById('addr').value.trim();
  const radiusKm = parseFloat(document.getElementById('radiusKm').value);
  const sectorFilter = normalizeSectorFromSelect(document.getElementById('secteur').value);
  const typesSel = Array.from(document.getElementById('types').selectedOptions).map(o => o.value);
  const typesWanted = new Set(typesSel.length ? typesSel : ["ecole","college","lycee"]);
  if (!q){ showErr("Saisis une adresse, une ville ou un code département"); return; }

  const token = ++_searchToken;
  const btn = document.getElementById('go');
  btn.disabled = true;
  setCount("Chargement…");
  try {
    const dep = deptFromQuery(q);
    if (dep) {
      await runDeptRankingLocal(dep, sectorFilter, typesWanted);
    } else {
      await runAround(q, radiusKm, sectorFilter, typesWanted);
    }
  } catch(e){
    if (token !== _searchToken) return;   // une recherche plus récente a pris la main
    console.error(e);
    setCount("—");
    showErr("Erreur : " + (e?.message || e));
  } finally {
    if (token === _searchToken) btn.disabled = false;
  }
}

/** relance la recherche seulement si une requête est déjà saisie */
function rerunIfQuery(){
  if (document.getElementById('addr').value.trim()) runSearch();
}

/* bind */
document.getElementById('go').addEventListener('click', runSearch);
document.getElementById('addr').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
document.getElementById('secteur').addEventListener('change', rerunIfQuery);
document.getElementById('radiusKm').addEventListener('change', rerunIfQuery);
document.getElementById('types').addEventListener('change', rerunIfQuery);

// (stations) écoute les cases à cocher
for (const id of Object.values(MODE_IDS)){
  const el = document.getElementById(id);
  if (el){
    el.addEventListener('change', refreshStations);
  }
}

// précharge au besoin
// n'amorce que l'index des départements (quelques Ko), pas les données
document.getElementById('addr').addEventListener('focus', async () => {
  if (!Store.ready){ try { await Store.load(); } catch{} }
});
