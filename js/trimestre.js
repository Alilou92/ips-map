// js/trimestre.js — détail trimestriel du prix au m² (repli optionnel des blocs prix)
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

/**
 * Table HTML "Détail trimestriel", repliée par défaut. `series` = tableau de
 * { label, valeurs, ventes } alignés sur `trimestres`. N'affiche que les
 * trimestres où au moins une série a une valeur, du plus récent au plus
 * ancien. Retourne "" si aucune série n'a de quoi être montrée.
 */
export function trimestreTableHtml(trimestres, series, minVentes) {
  const utiles = (series || []).filter(s => Array.isArray(s.valeurs) && s.valeurs.some(v => v != null));
  if (!utiles.length || !Array.isArray(trimestres) || !trimestres.length) return "";

  const lignes = [];
  for (let i = trimestres.length - 1; i >= 0; i--) {
    const vals = utiles.map(s => s.valeurs[i]);
    if (vals.every(v => v == null)) continue;
    const cells = utiles.map((s, k) => {
      const v = vals[k];
      const n = Array.isArray(s.ventes) ? s.ventes[i] : null;
      return `<td>${v != null ? esc(euros(v)) : "—"}${v != null && n ? `<span class="trim-n"> (${n})</span>` : ""}</td>`;
    }).join("");
    lignes.push(`<tr><td class="trim-t">${esc(labelTrimestre(trimestres[i]))}</td>${cells}</tr>`);
  }
  if (!lignes.length) return "";

  const head = utiles.map(s => `<th>${esc(s.label)}</th>`).join("");
  return `<details class="trim-detail">
    <summary>Détail trimestriel</summary>
    <table class="trim-table">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>${lignes.join("")}</tbody>
    </table>
    <div class="trim-note">Entre parenthèses : nombre de ventes. Trimestre sans médiane
      fiable (moins de ${minVentes || 5} ventes) laissé vide.</div>
  </details>`;
}

export default { labelTrimestre, trimestreTableHtml };
