// js/ui.js
import { examSummary } from "./exams.js?v=5";
import { prixHtml } from "./prix.js?v=7";
import { secteurIndicsHtml } from "./secteurIndics.js?v=5";

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
 * Rend le premier bloc de `box` repliable, sans dupliquer son titre : le
 * titre (`.prix-h` ou `.secteur-h`) devient le <summary> natif. Ouvert par
 * défaut — rien ne change visuellement tant qu'on ne clique pas — mais
 * l'utilisateur peut replier pour retrouver de la place au-dessus de la
 * liste des résultats. Dégrade silencieusement si la structure attendue
 * (le titre en premier enfant direct) est absente.
 */
function makeCollapsible(box, headerClass){
  const inner = box.firstElementChild;
  if (!inner) return;
  const header = inner.querySelector(`:scope > .${headerClass}`);
  if (!header) return;

  const details = document.createElement('details');
  details.className = inner.className + ' collapsible';
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = header.className;   // conserve le style visuel du titre
  while (header.firstChild) summary.appendChild(header.firstChild);
  header.remove();

  details.appendChild(summary);
  while (inner.firstChild) details.appendChild(inner.firstChild);
  inner.replaceWith(details);
}

/**
 * Bloc « collège de secteur » au-dessus des résultats.
 * res  = retour de collegeDeSecteur(), etab = l'établissement correspondant.
 */
export function renderSecteur({ res, etab, ips, exams, examsMeta, label, onClick, choix,
                                ipsSerie, secteurPrix, prixMeta }){
  const box = document.getElementById('secteurBox');
  if (!box) return;
  box.innerHTML = "";
  if (!res) return;

  const el = document.createElement('div');
  el.className = "secteur";

  if (res.precisionRequise){
    // Paris/Lyon/Marseille cherchées seules : le code INSEE de la ville-mère
    // ne figure dans aucune carte scolaire (elle ne connaît que les
    // arrondissements) — à ne pas confondre avec un vrai département non
    // couvert (res.indisponible, message différent).
    el.innerHTML = `<div class="secteur-h">Collège de secteur</div>
      <div class="secteur-sub">« ${res.precisionRequise} » compte plusieurs arrondissements :
      indique-en un (ex. « ${res.precisionRequise} 15e »), un code postal, ou une adresse
      complète.</div>`;
    box.appendChild(el); makeCollapsible(box, 'secteur-h'); return;
  }
  if (res.indisponible){
    el.innerHTML = `<div class="secteur-h">Collège de secteur</div>
      <div class="secteur-sub">Carte scolaire non publiée pour le département ${res.dep}.</div>`;
    box.appendChild(el); makeCollapsible(box, 'secteur-h'); return;
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
    box.appendChild(el); makeCollapsible(box, 'secteur-h'); return;
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
    ${approx}
    ${secteurIndicsHtml({ ipsSerie, secteurPrix, meta: prixMeta || {} })}`;

  if (typeof onClick === "function"){
    // Le clic reste précis sur le nom du collège, pas sur toute la carte :
    // makeCollapsible() déplace le contenu vers un <details>, et un clic sur
    // la courbe de prix ne doit pas être interprété comme "centrer la carte".
    const nameEl = el.querySelector('.secteur-name');
    if (nameEl){
      nameEl.style.cursor = "pointer";
      nameEl.title = "Centrer la carte sur ce collège";
      nameEl.addEventListener('click', onClick);
    }
  }
  box.appendChild(el);
  makeCollapsible(box, 'secteur-h');
}

/** Bloc « prix au m² » de la commune cherchée */
export function renderPrix({ prix, meta, commune, dep, precisionRequise }){
  const box = document.getElementById('prixBox');
  if (!box) return;
  box.innerHTML = prixHtml(prix ?? null, meta, commune, dep, precisionRequise);
  makeCollapsible(box, 'prix-h');
}

export function clearPrix(){
  const box = document.getElementById('prixBox');
  if (box) box.innerHTML = "";
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
