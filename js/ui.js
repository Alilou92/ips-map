// js/ui.js
export function showErr(msg){ const el=document.getElementById('err'); el.textContent=msg; el.classList.add('show'); }
export function clearErr(){ const el=document.getElementById('err'); el.textContent=""; el.classList.remove('show'); }
export function setCount(txt){ document.getElementById('count').textContent = txt; }

export function renderList({ items, ipsMap, markersByUai, map }){
  const list = document.getElementById('list');
  list.innerHTML = "";
  for (const f of items){
    const ips = ipsMap ? ipsMap.get(f.uai) : f.ips;
    const row = document.createElement('div');
    row.className = "item";
    const typeHuman = (f.type||"?")
      .replace("ecole","École").replace("college","Collège").replace("lycee","Lycée");

    row.innerHTML = `
      <div class="name">${f.name||"Établissement"}<span class="badge">${f.secteur||"—"}</span></div>
      <div class="meta">${typeHuman} — ${f.commune||""}</div>
      <div class="meta">IPS : ${ips!=null?Number(ips).toFixed(1):"—"} • UAI : ${f.uai}</div>`;

    row.addEventListener('click', ()=>{
      const m = markersByUai.get(f.uai);
      if (m){ map.setView(m.getLatLng(), 16); m.openPopup(); }
    });
    list.appendChild(row);
  }
}
