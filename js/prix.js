// js/prix.js — mise en forme du prix au m² (source DVF, DGFiP)
//
// Ce qu'on affiche est la MÉDIANE des ventes de la commune sur le dernier
// millésime complet, appartements et maisons séparés — les mélanger rend le
// chiffre ininterprétable dans une commune mixte.
//
// Deux limites à garder en tête, signalées dans l'interface :
//   • DVF n'existe pas en Alsace-Moselle ni à Mayotte (livre foncier) ;
//   • une médiane communale masque de forts écarts entre quartiers, surtout
//     dans les grandes villes — Paris, Lyon et Marseille sont au moins
//     découpés par arrondissement, puisque ce sont des communes INSEE.

import { trimestreDetailHtml } from "./trimestre.js?v=3";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const euros = (v) => Number.isFinite(Number(v))
  ? `${Math.round(Number(v)).toLocaleString("fr-FR")} €` : null;

/** "−4 %" / "+1 %" / null si le millésime précédent manque */
function evolution(cur, prec) {
  const a = Number(cur), b = Number(prec);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const pct = 100 * (a - b) / b;
  if (Math.abs(pct) < 0.5) return "stable";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)} %`;
}

/** Dernière et première valeur non nulles d'une série annuelle */
function bornes(serie, annees) {
  if (!Array.isArray(serie)) return null;
  let premier = null, dernier = null;
  for (let i = 0; i < serie.length; i++) {
    if (serie[i] == null) continue;
    if (premier === null) premier = { v: serie[i], an: annees[i] };
    dernier = { v: serie[i], an: annees[i] };
  }
  return dernier ? { premier, dernier } : null;
}

/** Lignes exploitables : appartement puis maison */
export function prixRows(prix, meta = {}) {
  if (!prix) return [];
  const annees = (meta.annees || []).map(String);
  const out = [];
  for (const [cle, label, nCle] of [
    ["appt", "Appartement", "nAppt"],
    ["maison", "Maison", "nMaison"],
  ]) {
    const b = bornes(prix[cle], annees);
    if (!b) continue;
    const nb = Array.isArray(prix[nCle])
      ? prix[nCle].reduce((a, x) => a + (x || 0), 0) : null;
    out.push({
      label,
      valeur: b.dernier.v,
      ventes: nb,
      evol: b.premier.an !== b.dernier.an ? evolution(b.dernier.v, b.premier.v) : null,
      annee: b.dernier.an,
      prec: b.premier.an,
    });
  }
  return out;
}

/** Bloc HTML du prix au m² pour une commune */
export function prixHtml(prix, meta = {}, commune = "", dep = null, precisionRequise = null) {
  const rows = prixRows(prix, meta);
  if (!rows.length) {
    // Paris/Lyon/Marseille cherchées seules : le code INSEE de la ville-mère
    // n'existe dans aucune donnée, ce n'est pas un manque de ventes.
    if (precisionRequise) {
      return `<div class="prix"><div class="prix-h">Prix au m²</div>
        <div class="prix-sub">« ${esc(precisionRequise)} » compte plusieurs arrondissements :
        indique-en un (ex. « ${esc(precisionRequise)} 15e »), un code postal, ou une adresse
        complète pour voir le prix au m².</div></div>`;
    }
    // Absence de source et absence de ventes ne se disent pas pareil
    const absents = Array.isArray(meta.absents) ? meta.absents : [];
    if (dep && absents.includes(String(dep))) {
      return `<div class="prix"><div class="prix-h">Prix au m²</div>
        <div class="prix-sub">DVF ne couvre ni l’Alsace-Moselle ni Mayotte
        (régime du livre foncier) : aucun prix publié pour ce département.</div></div>`;
    }
    if (prix === null && commune) {
      return `<div class="prix"><div class="prix-h">Prix au m²</div>
        <div class="prix-sub">Moins de ${meta.minVentes || 5} ventes recensées à
        ${esc(commune)} sur l’année : pas de médiane fiable.</div></div>`;
    }
    return "";
  }

  const lignes = rows.map(r => {
    const details = [];
    if (r.evol) details.push(`${r.evol} depuis ${r.prec}`);
    if (r.ventes != null) details.push(`${r.ventes} vente${r.ventes > 1 ? "s" : ""} sur ${(meta.annees||[]).length} ans`);
    return `<div class="prix-row">
      <span class="prix-label">${esc(r.label)}</span>
      <strong>${esc(euros(r.valeur))}</strong><span class="prix-unite">/m²</span>
      ${details.length ? `<div class="prix-sub">${esc(details.join(" • "))}</div>` : ""}
    </div>`;
  }).join("");

  const an = rows[0].annee ? ` ${rows[0].annee}` : "";
  const detail = trimestreDetailHtml(meta.trimestres || [], [
    { label: "Appartement", valeurs: prix.apptT, ventes: prix.nApptT, couleur: "#4ea1ff" },
    { label: "Maison", valeurs: prix.maisonT, ventes: prix.nMaisonT, couleur: "#f0883e" },
  ], meta.minVentes);
  return `<div class="prix">
    <div class="prix-h">Prix au m²${an}${commune ? ` · ${esc(commune)}` : ""}</div>
    ${lignes}
    <div class="prix-note">Médiane des ventes de la commune (DVF). Un chiffre communal
      masque les écarts entre quartiers.</div>
    ${detail}
  </div>`;
}

export default { prixRows, prixHtml };
