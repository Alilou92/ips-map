export function setCount(text){
  const el = document.getElementById('count');
  if (el) el.textContent = text;
}
export function showErr(msg){
  const b = document.getElementById('err');
  if (!b) return;
  b.textContent = msg;
  b.style.display = 'block';
  setTimeout(()=>{ b.style.display='none'; }, 6000);
}
export function renderList({ items, ipsMap, markersByUai, map }){
  const list = document.getElementById('list');
  const count = document.getElementById('count');
  list.innerHTML = "";
  count.textContent = `${items.length} établissement(s)`;
  const frag = document.createDocumentFragment();
  items.forEach(it => {
    const ips = ipsMap.has(it.uai) ? ipsMap.get(it.uai) : null;
    const li = document.createElement('div');
    li.className = 'item';
    const tLabel = (it.type==="ecole"?"École":it.type==="college"?"Collège":"Lycée");
    const dist = (it.distance!=null) ? `${(it.distance/1000).toFixed(2)} km` : '—';
    li.innerHTML = `
      <div class="name">${it.name}<span class="badge">${it.secteur}</span></div>
      <div class="meta">${tLabel} — ${it.commune || ''} ${it.code_postal || ''}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <div class="ips">${ips!=null ? "IPS : "+ips.toFixed(1) : "IPS non publié"}</div>
        <div class="dist">• Distance : ${dist}</div>
      </div>`;
    li.addEventListener('click', () => {
      const m = markersByUai.get(it.uai);
      if (m) { map.setView(m.getLatLng(), 16); m.openPopup(); }
    });
    frag.appendChild(li);
  });
  list.appendChild(frag);
}
export async function renderDeptTop10({ dep, feats, sectorFilter, typesWanted, map, markersLayer, markerFor, fitToMarkers, getLatestRentree }){
  const { buildIPSIndex } = await import("./data.js");
  const uaisByType = {ecole:new Set(), college:new Set(), lycee:new Set()};
  feats.forEach(f => { if (f.type) uaisByType[f.type].add(f.uai); });
  const ipsMap = await buildIPSIndex(uaisByType);

  function topFor(type) {
    let arr = feats.filter(f => f.type===type);
    if (sectorFilter !== "all") arr = arr.filter(f => f.secteur===sectorFilter);
    arr = arr.map(f => ({...f, ips: ipsMap.get(f.uai)})).filter(x => x.ips!=null);
    arr.sort((a,b)=> b.ips - a.ips);
    return arr.slice(0,10);
  }

  const latest = {
    ecole: await getLatestRentree("fr-en-ips-ecoles-ap2022"),
    college: await getLatestRentree("fr-en-ips-colleges-ap2023"),
    lycee: await getLatestRentree("fr-en-ips-lycees-ap2023")
  };

  const list = document.getElementById('list');
  const count = document.getElementById('count');
  list.innerHTML = "";
  count.textContent = `Top 10 — Département ${dep.label} (${sectorFilter==="all"?"Tous secteurs":sectorFilter})`;

  const sections = [];
  const typesOrder = ["ecole","college","lycee"].filter(t=>typesWanted.has(t));
  typesOrder.forEach(t=>{
    const human = t==="ecole"?"Écoles":t==="college"?"Collèges":"Lycées";
    const top = topFor(t);
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sectionTitle">${human} — Top 10 (Rentrée ${latest[t] ?? "?"}) <span class="pill small">${dep.label}</span></div>`;
    top.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = "item";
      row.innerHTML = `
        <div class="name">#${idx+1} ${it.name}<span class="badge">${it.secteur}</span></div>
        <div class="meta">${human.slice(0,-1)} — ${it.commune || ''} ${it.code_postal || ''}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <div class="ips">IPS : ${it.ips.toFixed(1)}</div>
          <div class="dist">UAI : ${it.uai}</div>
        </div>`;
      row.addEventListener('click', ()=> {
        const m = L.marker([it.lat,it.lon]);
        map.setView([it.lat,it.lon], 16);
      });
      sec.appendChild(row);
    });
    sections.push({ type:t, nodes:sec, items:top });
  });

  markersLayer.clearLayers();
  const allTop = sections.flatMap(s=>s.items);
  allTop.forEach(f=>{
    const m = markerFor(f, new Map([[f.uai, f.ips]]));
    m.addTo(markersLayer);
  });
  if (allTop.length) fitToMarkers(map, allTop);
  else {
    const b = document.getElementById('err'); b.textContent="Aucun établissement avec IPS publié trouvé pour ce filtre dans ce département."; b.style.display='block';
  }
  sections.forEach(s=>list.appendChild(s.nodes));
}
