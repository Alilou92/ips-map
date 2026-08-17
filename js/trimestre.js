// js/trimestre.js — détail trimestriel du prix au m² (graphique, repli sous les blocs prix)
//
// Le point affiché par défaut reste annuel : le trimestre n'est qu'un niveau
// de détail à la demande, replié. Cf. tools/build.py::build_prix pour la
// justification statistique du choix trimestriel plutôt que mensuel (30 %
// d'écart mois à mois observé sans mouvement réel du marché).

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const euros = (v) => Number.isFinite(Number(v))
  ? `${Math.round(Number(v)).toLocaleString("fr-FR")} €` : null;

/** "2024-T3" -> "T3 2024" */
export function labelTrimestre(t) {
  const m = /^(\d{4})-T(\d)$/.exec(String(t || ""));
  return m ? `T${m[2]} ${m[1]}` : String(t || "");
}

const W = 560, H = 170, ML = 46, MR = 12, MT = 14, MB = 22;
const xAt = (i, n) => ML + (i / (n - 1)) * (W - ML - MR);
const yAt = (v, yMin, yMax) => H - MB - ((v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);

// Un seul jeu de données par graphique, retrouvé au survol via data-chart-id
// — le HTML est généré en chaîne puis injecté par innerHTML ailleurs, donc
// aucun écouteur ne peut être posé au moment de la construction du SVG.
let chartSeq = 0;
const chartData = new Map();

/**
 * Courbe SVG "Détail trimestriel", repliée par défaut. `series` = tableau de
 * { label, valeurs, ventes, couleur } alignés sur `trimestres`. Un trimestre
 * sans médiane fiable (moins de PRIX_MIN_VENTES ventes) casse la ligne au
 * lieu d'être interpolé — la courbe ne doit pas paraître plus lisse que les
 * données ne le permettent. Le pointeur affiche le prix exact au survol,
 * pas seulement sur les points.
 */
export function trimestreDetailHtml(trimestres, series, minVentes) {
  const utiles = (series || []).filter(s => Array.isArray(s.valeurs) && s.valeurs.some(v => v != null));
  if (!utiles.length || !Array.isArray(trimestres) || trimestres.length < 2) return "";

  const tous = utiles.flatMap(s => s.valeurs.filter(v => v != null));
  const min = Math.min(...tous), max = Math.max(...tous);
  const pad = (max - min) * 0.12 || Math.max(1, max * 0.1);
  const yMin = Math.max(0, min - pad), yMax = max + pad;

  const n = trimestres.length;
  const x = (i) => xAt(i, n);
  const y = (v) => yAt(v, yMin, yMax);

  const chartId = `tc${chartSeq++}`;
  chartData.set(chartId, { trimestres, series: utiles, yMin, yMax, n });

  const courbes = utiles.map((s, idx) => {
    const segs = [];
    let cur = [];
    for (let i = 0; i < n; i++) {
      const v = s.valeurs[i];
      if (v == null) { if (cur.length) segs.push(cur); cur = []; continue; }
      cur.push([i, v]);
    }
    if (cur.length) segs.push(cur);

    const traits = segs.filter(seg => seg.length > 1).map(seg =>
      `<path d="${seg.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"
             fill="none" stroke="${s.couleur}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`
    ).join("");

    const points = segs.flat().map(([i, v]) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" fill="${s.couleur}"/>`
    ).join("");

    // point de survol, invisible tant que la souris n'est pas sur la courbe
    const hoverDot = `<circle class="trim-hover-dot" data-series="${idx}" r="3.5"
      fill="${s.couleur}" stroke="#0d111a" stroke-width="1" style="display:none"/>`;

    return traits + points + hoverDot;
  }).join("");

  // axe X : une graduation par année, alignée sur le premier trimestre disponible
  const annees = [...new Set(trimestres.map(t => t.split("-")[0]))];
  const axeX = annees.map(a => {
    const i = trimestres.indexOf(`${a}-T1`);
    if (i < 0) return "";
    return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="trim-axe" text-anchor="middle">${esc(a)}</text>`;
  }).join("");

  // axe Y : bas, milieu, haut de l'échelle
  const axeY = [yMin, (yMin + yMax) / 2, yMax].map(v =>
    `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}" class="trim-grille"/>
     <text x="${ML - 6}" y="${(y(v) + 3).toFixed(1)}" class="trim-axe" text-anchor="end">${Math.round(v).toLocaleString("fr-FR")}</text>`
  ).join("");

  const legende = utiles.map(s =>
    `<span class="trim-legende-item"><i style="background:${s.couleur}"></i>${esc(s.label)}</span>`
  ).join("");

  return `<details class="trim-detail">
    <summary>Détail trimestriel</summary>
    <div class="trim-legende">${legende}</div>
    <svg class="trim-chart" data-chart-id="${chartId}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Évolution trimestrielle du prix au m²">
      ${axeY}
      ${axeX}
      ${courbes}
      <line class="trim-hover-line" x1="0" y1="${MT}" x2="0" y2="${H - MB}" style="display:none"/>
      <rect class="trim-hover-zone" x="${ML}" y="${MT}" width="${W - ML - MR}" height="${H - MT - MB}" fill="transparent"/>
    </svg>
    <div class="trim-note">Survole la courbe pour voir le prix exact. Trimestre sans médiane
      fiable (moins de ${minVentes || 5} ventes) laissé en trou dans la courbe.</div>
  </details>`;
}

/* ---------- interaction au survol : un seul écouteur pour tous les graphiques ---------- */

function tooltipEl() {
  let el = document.getElementById("trim-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.id = "trim-tooltip";
    el.className = "trim-tooltip";
    document.body.appendChild(el);
  }
  return el;
}

function hideHover(svg) {
  tooltipEl().style.display = "none";
  const scope = svg || document;
  scope.querySelectorAll(".trim-hover-line, .trim-hover-dot").forEach(el => { el.style.display = "none"; });
}

function onPointerMove(e) {
  const svg = e.target.closest && e.target.closest(".trim-chart");
  if (!svg) { hideHover(); return; }

  const data = chartData.get(svg.dataset.chartId);
  if (!data) return;

  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  const userX = (e.clientX - rect.left) * (W / rect.width);
  let i = Math.round(((userX - ML) / (W - ML - MR)) * (data.n - 1));
  i = Math.max(0, Math.min(data.n - 1, i));

  const gx = xAt(i, data.n);
  const line = svg.querySelector(".trim-hover-line");
  if (line) { line.setAttribute("x1", gx); line.setAttribute("x2", gx); line.style.display = ""; }

  svg.querySelectorAll(".trim-hover-dot").forEach(dot => {
    const s = data.series[+dot.dataset.series];
    const v = s.valeurs[i];
    if (v == null) { dot.style.display = "none"; return; }
    dot.setAttribute("cx", gx);
    dot.setAttribute("cy", yAt(v, data.yMin, data.yMax));
    dot.style.display = "";
  });

  const lignes = data.series.map(s => {
    const v = s.valeurs[i];
    const nv = Array.isArray(s.ventes) ? s.ventes[i] : null;
    const val = v != null ? esc(euros(v)) : "pas de médiane fiable";
    return `<div class="trim-tooltip-row"><i style="background:${s.couleur}"></i>${esc(s.label)} : <strong>${val}</strong>${
      v != null && nv ? ` <span class="trim-tooltip-n">(${nv} ventes)</span>` : ""}</div>`;
  }).join("");

  const tip = tooltipEl();
  tip.innerHTML = `<div class="trim-tooltip-t">${esc(labelTrimestre(data.trimestres[i]))}</div>${lignes}`;
  tip.style.display = "block";
  // évite de faire déborder l'infobulle hors de l'écran sur les bords
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = e.clientX + 14, top = e.clientY + 14;
  if (left + tw > window.innerWidth) left = e.clientX - tw - 14;
  if (top + th > window.innerHeight) top = e.clientY - th - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

if (typeof document !== "undefined") {
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerdown", onPointerMove);
}

export default { labelTrimestre, trimestreDetailHtml };
