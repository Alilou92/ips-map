import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js";
import { geocode } from "./geocode.js";
import { fetchEstablishmentsAround, fetchEstablishmentsInDepartement, buildIPSIndex, getLatestRentree, resolveDepartement } from "./data.js";
import { distanceMeters, isDeptCode } from "./util.js";
import { renderList, renderDeptTop10, setCount, showErr } from "./ui.js";

const { map, markersLayer } = initMap();
let addrCircle = null;
let addrLat = null, addrLon = null;

async function runDeptRanking(q, sectorFilter, typesWanted) {
  const dep = await resolveDepartement(q);
  if (!dep) throw new Error("Département non reconnu");
  const feats = await fetchEstablishmentsInDepartement(dep.code);
  const featsFiltered = feats.filter(x => x.type && typesWanted.has(x.type));
  await renderDeptTop10({ dep, feats: featsFiltered, sectorFilter, typesWanted, map, markersLayer, markerFor, fitToMarkers, getLatestRentree });
}

async function runAddressSearch(q, radiusKm, sectorFilter, typesWanted) {
  const { lat, lon, label } = await geocode(q);
  addrLat = lat; addrLon = lon;

  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }
  addrCircle = drawAddressCircle(map, lat, lon, radiusKm * 1000);

  markersLayer.clearLayers();
  const feats = await fetchEstablishmentsAround(lat, lon, radiusKm * 1000, sectorFilter, typesWanted);

  const uaisByType = { ecole: new Set(), college: new Set(), lycee: new Set() };
  for (const f of feats) uaisByType[f.type].add(f.uai);
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

  feats.sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));
  renderList({ items: feats, ipsMap, markersByUai, map });
}

async function runSearch() {
  const q = document.getElementById('addr').value.trim();
  const radiusKm = parseFloat(document.getElementById('radiusKm').value);
  const sectorFilter = document.getElementById('secteur').value;
  const typesSel = Array.from(document.getElementById('types').selectedOptions).map(o => o.value);
  const typesWanted = new Set(typesSel.length ? typesSel : ["ecole", "college", "lycee"]);
  if (!q) { showErr("Saisis une adresse ou un département"); return; }

  const btn = document.getElementById('go');
  btn.disabled = true;
  setCount("Chargement…");
  try {
    const maybeCode = isDeptCode(q);
    const looksLikeDept = !!maybeCode || /(^|\b)(départ|dept|dpt|seine|val|corse|alpes|hauts|haute|bouches|côtes|landes|loir|eure|yonne|vienne|marne|somme|loire|vaucluse|var|ain|aisne|ardennes|aveyron|lot|dordogne|hérault|tarn|gers|bretagne|finistère|cantal|doubs|saône|lozère|charente|savoie|isère|gironde|lot-et|haute|moselle|bas-rhin|haut-rhin|pyrénées|yonne|yvelines|paris)\b/i.test(q);
    if (looksLikeDept) {
      await runDeptRanking(q, sectorFilter, typesWanted);
      return;
    }
    await runAddressSearch(q, radiusKm, sectorFilter, typesWanted);
  } catch (e) {
    console.error(e);
    showErr("Erreur : " + e.message);
    try { await runDeptRanking(q, sectorFilter, typesWanted); } catch(_) {}
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('go').addEventListener('click', runSearch);
document.getElementById('addr').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
