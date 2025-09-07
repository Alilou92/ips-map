// js/app.js — recherche + filtres + stations IDFM/SNCF
import Store from "./store.js?v=24";
import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js?v=2";
import { geocode } from "./geocode.js?v=2";
import { renderList, setCount, showErr } from "./ui.js?v=2";
// cache-bust + correspond au fichier stations corrigé
import { makeStationsController } from "./stations.js?v=12";

/* helpers */
function clearErr(){ const el = document.getElementById('err'); if (el) el.textContent = ''; }
const DEPT_RE = /^(?:0?[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/i;
const looksLikeDept = (q) => DEPT_RE.test(String(q).trim());
function normDept(q){
  let s = String(q).trim().toUpperCase();
  if (s === "2A" || s === "2B") return s;
  if (/^\d{1,2}$/.test(s)) return s.padStart(2,"0");
  if (/^97[1-6]$/.test(s)) return s;
  return s;
}
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

/* ───────── Adaptation mobile : hauteur dynamique de la carte ───────── */
window._leafletMap = map; // exposé pour invalider la taille après resize
function resizeMapToViewport() {
  const top = document.querySelector('.top');
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  const topH = top ? top.offsetHeight : 0;
  const h = Math.max(240, window.innerHeight - topH);
  mapEl.style.height = h + 'px';
  requestAnimationFrame(() => {
    try { window._leafletMap && window._leafletMap.invalidateSize(); } catch {}
  });
}
window.addEventListener('resize', resizeMapToViewport, { passive: true });
window.addEventListener('orientationchange', resizeMapToViewport, { passive: true });
window.addEventListener('DOMContentLoaded', resizeMapToViewport, { passive: true });
resizeMapToViewport();

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
  if (!Store.ready) await Store.load();

  // pour une recherche départementale, on masque les stations
  Stations.clear();
  addrLat = null; addrLon = null; lastRadiusMeters = 0;

  const top = Store.top10ByDept(dep, typesWanted, sectorFilter);

  const count = document.getElementById('count');
  const list  = document.getElementById('list');
  list.innerHTML = "";
  count.textContent = `Top 10 — Département ${dep} (${sectorFilter==="all"?"Tous secteurs":sectorFilter})`;

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
        const m = markerFor({ ...it, type:t }, new Map([[it.uai, it.ips]]));
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
  else showErr("Top 10 listé (peu de coordonnées disponibles pour la carte).");
}

/* autour d’une adresse */
async function runAround(q, radiusKm, sectorFilter, typesWanted){
  if (!Store.ready) await Store.load();

  const { lat, lon, label } = await geocode(q);
  addrLat = lat; addrLon = lon;

  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }
  addrCircle = drawAddressCircle(map, lat, lon, radiusKm * 1000);

  markersLayer.clearLayers();

  let items = Store.around(lat, lon, radiusKm * 1000, sectorFilter, typesWanted);

  // élargit si vide
  let triedKm = radiusKm;
  if (!items.length && radiusKm < 2){
    triedKm = 2;
    map.removeLayer(addrCircle);
    addrCircle = drawAddressCircle(map, lat, lon, 2000);
    items = Store.around(lat, lon, 2000, sectorFilter, typesWanted);
  }
  if (!items.length && radiusKm < 3){
    triedKm = 3;
    map.removeLayer(addrCircle);
    addrCircle = drawAddressCircle(map, lat, lon, 3000);
    items = Store.around(lat, lon, 3000, sectorFilter, typesWanted);
  }

  // mémorise le rayon pour les stations
  lastRadiusMeters = triedKm * 1000;

  const src = L.marker([lat, lon], {
    icon: L.divIcon({ className: 'src', html: '<div class="src-pin">A</div>' })
  }).bindPopup(`<strong>Adresse/ville</strong><div>${label}</div>`).addTo(markersLayer);

  if (!items.length){
    setCount("0 établissement trouvé");
    showErr("Aucun établissement trouvé autour de cette zone. Essaie d’augmenter le rayon.");
    map.setView([lat, lon], triedKm >= 2 ? 13 : 15);

    // même si aucun établissement, on peut afficher les stations autour
    await Stations.ensure({
      modesWanted: getModesWanted(),
      center: [lat, lon],
      radiusMeters: lastRadiusMeters
    });
    return;
  }

  const markersByUai = new Map();
  items.forEach(f => {
    const m = markerFor(f, Store.ipsMap);
    m.addTo(markersLayer);
    markersByUai.set(f.uai, m);
  });

  items.sort((a,b)=> (a.distance??1e12) - (b.distance??1e12));
  setCount(`${items.length} établissement${items.length>1?"s":""} dans ${triedKm} km — ${sectorFilter==="all"?"Tous secteurs":sectorFilter}`);
  renderList({ items, ipsMap: Store.ipsMap, markersByUai, map });

  fitToMarkers(map, items.concat([{lat, lon}]));
  src.openPopup();

  // charge/rafraîchit les stations pour ce centre/rayon
  await Stations.ensure({
    modesWanted: getModesWanted(),
    center: [lat, lon],
    radiusMeters: lastRadiusMeters
  });

  // Au cas où l'ouverture du popup décale la mise en page en mobile
  requestAnimationFrame(resizeMapToViewport);
}

/* contrôleur */
async function runSearch(){
  clearErr();
  const q = document.getElementById('addr').value.trim();
  const radiusKm = parseFloat(document.getElementById('radiusKm').value);
  const sectorFilter = normalizeSectorFromSelect(document.getElementById('secteur').value);
  const typesSel = Array.from(document.getElementById('types').selectedOptions).map(o => o.value);
  const typesWanted = new Set(typesSel.length ? typesSel : ["ecole","college","lycee"]);
  if (!q){ showErr("Saisis une adresse, une ville ou un code département"); return; }

  const btn = document.getElementById('go');
  btn.disabled = true;
  setCount("Chargement…");
  try {
    if (looksLikeDept(q)) {
      await runDeptRankingLocal(q, sectorFilter, typesWanted);
    } else {
      await runAround(q, radiusKm, sectorFilter, typesWanted);
    }
  } catch(e){
    console.error(e);
    showErr("Erreur : " + (e?.message || e));
  } finally {
    btn.disabled = false;
    // s'assure que la carte garde la hauteur correcte après rendu liste/markers
    requestAnimationFrame(resizeMapToViewport);
  }
}

/* bind */
document.getElementById('go').addEventListener('click', runSearch);
document.getElementById('addr').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
document.getElementById('secteur').addEventListener('change', runSearch);
document.getElementById('radiusKm').addEventListener('change', runSearch);
document.getElementById('types').addEventListener('change', runSearch);

// (stations) écoute les cases à cocher
for (const id of Object.values(MODE_IDS)){
  const el = document.getElementById(id);
  if (el){
    el.addEventListener('change', () => {
      refreshStations();
      requestAnimationFrame(resizeMapToViewport);
    });
  }
}

// précharge au besoin
document.getElementById('addr').addEventListener('focus', async () => {
  if (!Store.ready){ try { await Store.load(); } catch{} }
});
