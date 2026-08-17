// js/secteurIndics.js — indicateurs du secteur de carte scolaire d'un collège
//
// Deux séries sur le MÊME périmètre — celui qui décide de l'affectation :
//   • l'IPS du collège, qui mesure la recomposition sociale de son recrutement
//   • la médiane du prix au m² des ventes rattachées à ses rues
//
// Lire les deux ensemble est ce qui a du sens : un secteur dont l'IPS monte
// pendant que le prix suit est un quartier qui bascule ; un prix qui grimpe
// sans que l'IPS bouge raconte autre chose.
//
// Collèges publics uniquement — ni les écoles ni les lycées n'ont de carte
// scolaire nationale.

import { trimestreDetailHtml } from "./trimestre.js?v=3";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const euros = (v) => Number.isFinite(Number(v))
  ? `${Math.round(Number(v)).toLocaleString("fr-FR")} €` : null;

/** Premier et dernier point non nuls d'une série alignée sur des années */
function bornes(valeurs, annees) {
  let a = null, b = null;
  for (let i = 0; i < valeurs.length; i++) {
    if (valeurs[i] == null) continue;
    if (a === null) a = { v: valeurs[i], an: annees[i] };
    b = { v: valeurs[i], an: annees[i] };
  }
  return (a && b && a.an !== b.an) ? { debut: a, fin: b } : null;
}

/** Courbe en SVG inline : cinq points, aucune dépendance */
function sparkline(valeurs, couleur) {
  const pts = valeurs.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return "";
  const vals = pts.map(([, v]) => v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const etendue = max - min || 1;
  const W = 104, H = 26;
  const x = (i) => (i / Math.max(1, valeurs.length - 1)) * (W - 4) + 2;
  const y = (v) => H - 3 - ((v - min) / etendue) * (H - 8);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dernier = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${couleur}" stroke-width="1.6"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(dernier[0]).toFixed(1)}" cy="${y(dernier[1]).toFixed(1)}" r="2.2" fill="${couleur}"/>
  </svg>`;
}

/** Bloc HTML, ou "" si aucune des deux séries n'est exploitable */
export function secteurIndicsHtml({ ipsSerie, secteurPrix, meta = {} }) {
  const lignes = [];

  // IPS du collège, rentrée par rentrée
  if (ipsSerie) {
    const ans = Object.keys(ipsSerie).sort();
    const vals = ans.map(a => ipsSerie[a]);
    const b = bornes(vals, ans);
    if (b) {
      const d = b.fin.v - b.debut.v;
      const signe = d > 0 ? "+" : d < 0 ? "−" : "";
      const sens = Math.abs(d) < 0.5 ? "va-neu" : d > 0 ? "va-pos" : "va-neg";
      lignes.push(`<div class="ind-row">
        <span class="ind-label">IPS du collège</span>
        <strong>${b.debut.v.toFixed(1)} → ${b.fin.v.toFixed(1)}</strong>
        <span class="va ${sens}">${signe}${Math.abs(d).toFixed(1)} pts</span>
        ${sparkline(vals, "#4ea1ff")}
        <div class="ind-sub">rentrées ${esc(b.debut.an)} à ${esc(b.fin.an)}</div>
      </div>`);
    }
  }

  // Prix au m² des ventes rattachées aux rues du secteur
  if (secteurPrix && Array.isArray(secteurPrix.prix)) {
    const ans = (meta.annees || []).map(String);
    const b = bornes(secteurPrix.prix, ans);
    const dernier = [...secteurPrix.prix].reverse().find(v => v != null);
    if (dernier != null) {
      const ventes = secteurPrix.ventes ? secteurPrix.ventes.reduce((a, b2) => a + (b2 || 0), 0) : null;
      let evo = "";
      if (b) {
        // Une hausse de prix n'est ni une bonne ni une mauvaise nouvelle en
        // soi : pas de code couleur vert/rouge, contrairement à la VA.
        const pct = 100 * (b.fin.v - b.debut.v) / b.debut.v;
        evo = `<span class="va va-neu">${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)} % depuis ${esc(b.debut.an)}</span>`;
      }
      lignes.push(`<div class="ind-row">
        <span class="ind-label">Prix dans le secteur</span>
        <strong>${esc(euros(dernier))}</strong><span class="prix-unite">/m²</span>
        ${evo}
        ${sparkline(secteurPrix.prix, "#d2b23c")}
        <div class="ind-sub">${secteurPrix.rues ? `${secteurPrix.rues} tronçons de rue rattachés • ` : ""}${
          ventes ? `${ventes} ventes sur ${(meta.annees || []).length} ans` : ""}</div>
      </div>`);
      lignes.push(trimestreDetailHtml(meta.trimestres || [], [
        { label: "Secteur", valeurs: secteurPrix.prixT, ventes: secteurPrix.ventesT, couleur: "#d2b23c" },
      ], meta.minVentes));
    }
  }

  if (!lignes.length) return "";
  return `<div class="indics">${lignes.join("")}
    <div class="ind-note">Périmètre : les rues rattachées à ce collège par la carte
      scolaire. Médiane des ventes DVF, appartements et maisons confondus.</div>
  </div>`;
}

export default { secteurIndicsHtml };
