// js/ui.js
import { examSummary } from "./exams.js?v=1";

export function showErr(msg){
  const el=document.getElementById('err'); if(!el) return;
  el.textContent=msg; el.classList.add('show'); el.classList.remove('info');
}
export function showInfo(msg){
  const el=document.getElementById('err'); if(!el) return;
  el.textContent=msg; el.classList.add('show','info');
}
export function clearErr(){
  const el=document.getElementById('err'); if(!el) return;
  el.textContent=""; el.classList.remove('show','info');
}
export function setCount(txt){ const el=document.getElementById('count'); if(el) el.textContent = txt; }

/** Vide la liste des résultats (et affiche un message optionnel) */
export function clearList(msg){
  const list = document.getElementById('list'); if(!list) return;
  list.innerHTML = "";
  if (msg){
    const d = document.createElement('div');
    d.className = "small";
    d.style.margin = "6px 0";
    d.textContent = msg;
    list.appendChild(d);
  }
}

export function renderList({ items, ipsMap, markersByUai, map, examsMap, examsMeta }){
  const list = document.getElementById('list');
  list.innerHTML = "";
  for (const f of items){
    const ips = ipsMap ? ipsMap.get(f.uai) : f.ips;
    const row = document.createElement('div');
    row.className = "item";
    const typeHuman = (f.type||"?")
      .replace("ecole","École").replace("college","Collège").replace("lycee","Lycée");

    const ex = examsMap ? examSummary(examsMap.get(f.uai), examsMeta) : null;
    const exHtml = ex
      ? `<div class="meta">${ex.text}${ex.va!=null?` <span class="va ${ex.vaClass}" title="${ex.title}">VA ${ex.va}</span>`:""}</div>`
      : "";

    row.innerHTML = `
      <div class="name">${f.name||"Établissement"}<span class="badge">${f.secteur||"—"}</span></div>
      <div class="meta">${typeHuman} — ${f.commune||""}</div>
      <div class="meta">IPS : ${ips!=null?Number(ips).toFixed(1):"—"} • UAI : ${f.uai}</div>
      ${exHtml}`;

    row.addEventListener('click', ()=>{
      const m = markersByUai.get(f.uai);
      if (m){ map.setView(m.getLatLng(), 16); m.openPopup(); }
    });
    list.appendChild(row);
  }
}
