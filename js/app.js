import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js";
import { renderList, setCount, showErr, clearErr } from "./ui.js";
import { distanceMeters, isDeptCode, isPostcode, km2m } from "./util.js";
import Store from "./store.js";

/* Géocode très simple : 
   - si CP => centre de la commune via gazetteer
   - si nom de ville => centre via gazetteer
   - sinon ESSAI BAN puis Nominatim (uniquement pour adresses précises) */
async function geocodeLoose(q){
  const s = String(q).trim();
  if (isPostcode(s)){
    const c = Store.gazetteer.find(x => x.cps.includes(s));
    if (c) return { lat:c.lat, lon:c.lon, label:`${c.name} (${s})`, postcode:s, commune:c.name };
  }
  // commune par nom
  const c2 = Store.findCommune(s);
  if (c2) return { lat:c2.lat, lon:c2.lon, label:c2.name, commune:c2.name, postcode:c2.cps[0] };

  // adresse précise (BAN → Nominatim)
  const tryBAN = async (q) => {
    try{
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const js = await r.json();
      const f = js.features?.[0];
      if (!f) return null;
      const [lon, lat] = f.geometry.coordinates;
      return { lat, lon, label: f.properties?.label || q };
    }catch{return null;}
  };
  const tryNom = async (q) => {
    try{
      const url=`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&accept-language=fr`;
      const r=await fetch(url,{headers:{'Accept':'application/json'}});
      if(!r.ok) return null;
      const arr=await r.json(); if(!arr.length) return null;
      return { lat:Number(arr[0].lat), lon:Number(arr[0].lon), label:arr[0].display_name || q };
    }catch{return null;}
  };
  return await tryBAN(s) || await tryNom(s) || null;
}

/* Carte & couches */
const { map, markersLayer } = initMap();
let addrCircle=null;
let lastGeo=null;

/* Recherche par département → Top 10 local */
async function runDept(depCode, sector, typesWanted){
  const byType = Store.top10ByDept(depCode, typesWanted, sector);
  const list = [];
  for (const t of ["ecole","college","lycee"]){
    list.push(...byType[t]);
  }
  markersLayer.clearLayers();
  const markers = [];
  for (const e of list){
    const m = markerFor(e, null); // e.ips déjà injecté
    m.addTo(markersLayer);
    markers.push({lat:e.lat,lon:e.lon});
  }
  setCount(`Top 10 — Département ${depCode} (${sector==="all"?"Tous secteurs":sector})`);
  const sidebar = document.getElementById("list");
  sidebar.innerHTML = "";
  for (const t of ["ecole","college","lycee"]){
    if (!typesWanted.has(t)) continue;
    const human = t==="ecole"?"Écoles":t==="college"?"Collèges":"Lycées";
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sectionTitle">${human} — Top 10 <span class="pill">${depCode}</span></div>`;
    for (const e of byType[t]){
      const row = document.createElement('div');
      row.className="item";
      row.innerHTML = `
        <div class="name">${e.name}<span class="badge">${e.secteur}</span></div>
        <div class="meta">${human.slice(0,-1)} — ${e.commune||""}</div>
        <div class="meta">IPS : ${e.ips!=null?e.ips.toFixed(1):"—"} • UAI : ${e.uai}</div>`;
      sec.appendChild(row);
    }
    sidebar.appendChild(sec);
  }
  if (markers.length) fitToMarkers(map, markers);
  else showErr("Top 10 listé (pas assez de coordonnées).");
}

/* Recherche autour d’un point */
async function runAround(q, radiusKm, sector, typesWanted){
  const geo = await geocodeLoose(q);
  if (!geo){ showErr("Géocodage indisponible pour cette saisie."); return; }
  lastGeo = geo;
  const radiusM = km2m(radiusKm);

  if (addrCircle){ map.removeLayer(addrCircle); addrCircle=null; }
  markersLayer.clearLayers();

  addrCircle = drawAddressCircle(map, geo.lat, geo.lon, radiusM);

  // on filtre localement
  const all = Store.establishments.filter(e => (typesWanted.has(e.type)) && (sector==="all" || e.secteur===sector));
  const withDist = all.map(e => ({...e, distance: distanceMeters(geo.lat, geo.lon, e.lat, e.lon)}))
                      .filter(e => e.distance <= radiusM)
                      .sort((a,b)=>a.distance-b.distance);

  if (!withDist.length){
    setCount("0 établissement trouvé");
    showErr("Aucun établissement dans ce rayon (essaie 3 km).");
    return;
  }

  // join IPS local
  const ipsMap = Store.ipsMap;
  const markersByUai = new Map();
  for (const e of withDist){
    const ips = ipsMap.get(e.uai);
    const m = markerFor({...e, ips}, ipsMap);
    m.addTo(markersLayer);
    markersByUai.set(e.uai, m);
  }
  L.marker([geo.lat, geo.lon], {icon:L.divIcon({className:'src',html:'<div class="src-pin">A</div>'})})
    .bindPopup(`<strong>Point recherché</strong><div>${geo.label}</div>`).addTo(markersLayer).openPopup();

  setCount(`${withDist.length} établissement${withDist.length>1?"s":""} dans ${radiusKm} km`);
  renderList({ items: withDist, ipsMap, markersByUai, map });
  // centre
  fitToMarkers(map, withDist.concat([{lat:geo.lat,lon:geo.lon}]));
}

/* Contrôleur */
async function runSearch(){
  clearErr();
  const q = document.getElementById('addr').value.trim();
  const radiusKm = parseFloat(document.getElementById('radiusKm').value);
  const sector = document.getElementById('secteur').value;
  const typesSel = Array.from(document.getElementById('types').selectedOptions).map(o => o.value);
  const typesWanted = new Set(typesSel.length?typesSel:["ecole","college","lycee"]);
  if (!q){ showErr("Saisis un département, une ville, un code postal ou une adresse."); return; }

  const looksDept = isDeptCode(q);
  if (looksDept) await runDept(q.toUpperCase(), sector, typesWanted);
  else await runAround(q, radiusKm, sector, typesWanted);
}

/* Boot */
(async function(){
  await Store.load();
  document.getElementById('go').addEventListener('click', runSearch);
  document.getElementById('addr').addEventListener('keydown', e=>{ if(e.key==="Enter") runSearch(); });
  console.info("App prête — données locales chargées.");
})();
