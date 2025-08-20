// js/app.js (v=18)
import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js?v=18";
import { geocode } from "./geocode.js?v=18";
import {
  fetchEstablishmentsAround,
  buildIPSIndex,
  fetchTop10DeptDirect,
  fetchGeoByUai,
  resolveDepartement
} from "./data.js?v=18";
import { distanceMeters, isDeptCode } from "./util.js?v=18";
import { renderList, setCount, showErr } from "./ui.js?v=18";

const { map, markersLayer } = initMap();
let addrCircle = null;
let addrLat = null, addrLon = null;

function clearErr() { const el = document.getElementById('err'); if (el) el.textContent = ''; }

/* ---------- Top 10 par département ---------- */
async function runDeptRanking(q, sectorFilter, typesWanted) {
  const dep = await resolveDepartement(q);
  const depCode = dep?.code || q.trim();
  const { label, byType } = await fetchTop10DeptDirect(depCode, sectorFilter, typesWanted);

  const count = document.getElementById('count');
  const list  = document.getElementById('list');
  list.innerHTML = "";
  count.textContent = `Top 10 — Département ${label || depCode} (${sectorFilter==="all"?"Tous secteurs":sectorFilter})`;

  markersLayer.clearLayers();
  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }

  const order = ["ecole","college","lycee"].filter(t => typesWanted.has(t));
  for (const t of order){
    const human = t==="ecole" ? "Écoles" : t==="college" ? "Collèges" : "Lycées";
    const arr = byType[t] || [];

    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sectionTitle">${human} — Top 10 <span class="pill small">${label || depCode}</span></div>`;

    for (let i=0; i<arr.length; i++){
      const it = arr[i];
      try {
        if (it.uai && (it.lat==null || it.lon==null)) {
          const g = await fetchGeoByUai(it.uai);
          if (g){ it.lat=g.lat; it.lon=g.lon; }
        }
      } catch {}

      const row = document.createElement('div');
      row.className = "item";
      row.innerHTML = `
        <div class="name">#${i+1} ${it.name}<span class="badge">${it.secteur || "—"}</span></div>
        <div class="meta">${human.slice(0,-1)} — ${it.commune || ''}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <div class="ips">IPS : ${Number(it.ips).toFixed(1)}</div>
          <div class="dist">UAI : ${it.uai}</div>
        </div>`;
      if (it.lat && it.lon){
        const m = markerFor({ ...it, type:t }, new Map([[it.uai, it.ips]]));
        m.addTo(markersLayer);
        row.addEventListener('click', ()=> map.setView([it.lat,it.lon], 16));
      }
      sec.appendChild(row);
    }
    list.appendChild(sec);
  }

  const allWithCoords = order.flatMap(t => byType[t] || []).filter(x => x.lat && x.lon);
  if (allWithCoords.length) fitToMarkers(map, allWithCoords);
  else showErr("Top 10 listé (peu de coordonnées disponibles pour la carte).");
}

/* ---------- Autour d'une adresse ---------- */
async function runAddressSearch(q, radiusKm, sectorFilter, typesWanted) {
  const { lat, lon, label } = await geocode(q);
  addrLat = lat; addrLon = lon;

  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }
  addrCircle = drawAddressCircle(map, lat, lon, radiusKm * 1000);

  markersLayer.clearLayers();
  const feats = await fetchEstablishmentsAround(lat, lon, radiusKm * 1000, sectorFilter, typesWanted);

  if (!feats.length) {
    setCount("0 établissement trouvé dans le rayon");
    showErr("Aucun établissement trouvé autour de l’adresse (augmente le rayon ou vérifie l’orthographe).");
    L.marker([lat, lon], {
      icon: L.divIcon({ className: 'src', html: '<div class="src-pin">A</div>' })
    }).bindPopup(`<strong>Adresse recherchée</strong><div>${label}</div>`).addTo(markersLayer);
    return;
  }

  const uaisByType = { ecole: new Set(), college: new Set(), lycee: new Set() };
  for (const f of feats) if (f.type) uaisByType[f.type].add(f.uai);
  const ipsMap = await buildIPSIndex(uaisByType);

  const markersByUai = new Map();
  feats.forEach(f => {
    f.distance = distanceMeters(addrLat, addrLon, f.lat, f.lon);
    const m = markerFor(f, ipsMap);
    m.addTo(markersLayer);
    markersByUai.set(f.uai, m);
  });

  L.marker([lat, lon], {
    icon: L.divIcon({ className: 'src', html: '<div class="src-pin">A</div>' })
  }).bindPopup(`<strong>Adresse recherchée</strong><div>${label}</div>`).addTo(markersLayer);

  setCount(`${feats.length} établissement${feats.length>1?"s":""} dans ${radiusKm} km`);
  feats.sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));
  renderList({ items: feats, ipsMap, markersByUai, map });

  fitToMarkers(map, feats);
}

/* ---------- Contrôleur ---------- */
async function runSearch() {
  const q = document.getElementById('addr').value.trim();
  const radiusKm = parseFloat(document.getElementById('radiusKm').value);
  const sectorFilter = document.getElementById('secteur').value;
  const typesSel = Array.from(document.getElementById('types').selectedOptions).map(o => o.value);
  const typesWanted = new Set(typesSel.length ? typesSel : ["ecole", "college", "lycee"]);
  if (!q) { showErr
