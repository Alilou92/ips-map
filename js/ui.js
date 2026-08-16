// js/ui.js
import { examSummary } from "./exams.js?v=4";

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

/**
 * Bloc « collège de secteur » au-dessus des résultats.
 * res  = retour de collegeDeSecteur(), etab = l'établissement correspondant.
 */
export function renderSecteur({ res, etab, ips, exams, examsMeta, label, onClick, choix }){
  const box = document.getElementById('secteurBox');
  if (!box) return;
  box.innerHTML = "";
  if (!res) return;

  const el = document.createElement('div');
  el.className = "secteur";

  if (res.indisponible){
    el.innerHTML = `<div class="secteur-h">Collège de secteur</div>
      <div class="secteur-sub">Carte scolaire non publiée pour le département ${res.dep}.</div>`;
    box.appendChild(el); return;
  }
  if (res.ambigu){
    const noms = (choix || []).filter(Boolean);
    const raison = res.motif === "voie-partagee"
      ? "Cette adresse relève de plusieurs collèges (secteur partagé)."
      : "Plusieurs collèges desservent cette voie — précise le numéro dans l’adresse.";
    el.innerHTML = `<div class="secteur-h">Collège de secteur</div>
      <div class="secteur-sub">${raison}</div>
      ${noms.length ? `<div class="secteur-name" style="margin-top:4px">${
        noms.map(e => e.name || e.uai).join("<br>")}</div>` : ""}`;
    box.appendChild(el); return;
  }
  if (!etab) return;

  const ex = examSummary(exams, examsMeta);
  const approx = res.exact ? "" :
    `<div class="secteur-sub">Secteur déduit ${res.motif === "commune" || res.motif === "commune-unique"
      ? "de la commune (un seul collège de secteur)" : "de la voie entière"} — sans numéro de rue.</div>`;

  el.innerHTML = `
    <div class="secteur-h">Collège de secteur</div>
    <div class="secteur-name">${etab.name || "Collège"}</div>
    <div class="secteur-sub">${etab.commune || ""}${label ? ` — pour ${label}` : ""}</div>
    <div class="secteur-sub">IPS : ${Number.isFinite(Number(ips)) ? Number(ips).toFixed(1) : "—"}${
      ex ? ` • ${ex.text}${ex.va!=null?` <span class="va ${ex.vaClass}" title="${ex.title}">VA ${ex.va}</span>`:""}` : ""}</div>
    ${approx}`;

  if (typeof onClick === "function"){
    el.style.cursor = "pointer";
    el.addEventListener('click', onClick);
  }
  box.appendChild(el);
}

export function clearSecteur(){
  const box = document.getElementById('secteurBox');
  if (box) box.innerHTML = "";
}

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
