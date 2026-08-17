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

/**
 * Courbe SVG "Détail trimestriel", repliée par défaut. `series` = tableau de
 * { label, valeurs, ventes, couleur } alignés sur `trimestres`. Un trimestre
 * sans médiane fiable (moins de PRIX_MIN_VENTES ventes) casse la ligne au
 * lieu d'être interpolé — la courbe ne doit pas paraître plus lisse que les
 * données ne le permettent.
 */
export function trimestreDetailHtml(trimestres, series, minVentes) {
  const utiles = (series || []).filter(s => Array.isArray(s.valeurs) && s.valeurs.some(v => v != null));
  if (!utiles.length || !Array.isArray(trimestres) || trimestres.length < 2) return "";

  const tous = utiles.flatMap(s => s.valeurs.filter(v => v != null));
  const min = Math.min(...tous), max = Math.max(...tous);
  const pad = (max - min) * 0.12 || Math.max(1, max * 0.1);
  const yMin = Math.max(0, min - pad), yMax = max + pad;

  const n = trimestres.length;
  const x = (i) => ML + (i / (n - 1)) * (W - ML - MR);
  const y = (v) => H - MB - ((v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);

  const courbes = utiles.map(s => {
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

    const points = segs.flat().map(([i, v]) => {
      const nv = Array.isArray(s.ventes) ? s.ventes[i] : null;
      const titre = `${labelTrimestre(trimestres[i])} — ${euros(v)}${nv ? ` (${nv} ventes)` : ""}`;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" fill="${s.couleur}"><title>${esc(titre)}</title></circle>`;
    }).join("");

    return traits + points;
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
    <svg class="trim-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution trimestrielle du prix au m²">
      ${axeY}
      ${axeX}
      ${courbes}
    </svg>
    <div class="trim-note">Survole un point pour le détail. Trimestre sans médiane
      fiable (moins de ${minVentes || 5} ventes) laissé en trou dans la courbe.</div>
  </details>`;
}

export default { labelTrimestre, trimestreDetailHtml };
