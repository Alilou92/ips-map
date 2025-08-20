// js/ui.js (v=18)
export function setCount(txt){ const el = document.getElementById('count'); if (el) el.textContent = txt; }
export function showErr(msg){ const el = document.getElementById('err'); if (el) el.textContent = msg || ""; }

function labelForType(t){ return t==="ecole"?"École":t==="college"?"Collège":t==="lycee"?"Lycée":"Établissement"; }

export function renderList({ items, ipsMap, markersByUai, map }){
  const list = document.getElementById('list');
  list.innerHTML = "";

  for (const it of items){
    const ips = ipsMap?.get(it.uai);
    const row = document.createElement('div');
    row.className = "item";
    row.innerHTML = `
      <div class="name">${it.name}<span class="badge">${it.secteur || "—"}</span></div>
      <div class="meta">${labelForType(it.type)} — ${it.commune || ''}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <div class="ips">IPS : ${ips==null || isNaN(ips) ? '<span style="color:#777">non publié</span>' : ips.toFixed(1)}</div>
        ${it.distance!=null ? `<div class="dist">${Math.round(it.distance)} m</div>` : ''}
      </div>
    `;
    row.addEventListener('click', ()=>{
      const m = markersByUai?.get(it.uai);
      if (m){ m.openPopup(); map.setView(m.getLatLng(), 16); }
    });
    list.appendChild(row);
  }

  setCount(`${items.length} établissement${items.length>1?"s":""} listé${items.length>1?"s":""}`);
}
