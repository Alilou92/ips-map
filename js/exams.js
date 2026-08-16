// js/exams.js — mise en forme des résultats aux examens (brevet / bac)
//
// Deux chiffres différents, à ne pas confondre :
//   • le taux de réussite      -> ce que l'établissement obtient
//   • la valeur ajoutée (VA)   -> l'écart avec ce qu'on attendait de lui compte
//                                 tenu du profil social de ses élèves
// Un fort taux dans un quartier aisé n'apprend presque rien ; une VA positive
// dit que l'établissement tire ses élèves au-dessus de leur trajectoire attendue.

const LABEL = {
  brevet:  "Brevet",
  bac_gt:  "Bac général et techno",
  bac_pro: "Bac pro",
};

const ORDER = ["brevet", "bac_gt", "bac_pro"];

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(0).replace(".", ",")} %` : null;

/** "+2" / "−3" / null — la VA est en points de taux de réussite */
function fmtVa(va) {
  const v = Number(va);
  if (!Number.isFinite(v)) return null;
  if (v === 0) return "0";
  return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(0);
}

function vaClass(va) {
  const v = Number(va);
  if (!Number.isFinite(v)) return "";
  if (v >= 2) return "va-pos";
  if (v <= -2) return "va-neg";
  return "va-neu";
}

/** Décrit une VA en clair, pour l'attribut title */
function vaTitle(va) {
  const v = Number(va);
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "Résultat conforme à ce qu'on attendait vu le profil social des élèves";
  const sens = v > 0 ? "au-dessus" : "en dessous";
  return `${Math.abs(v)} points ${sens} du résultat attendu vu le profil social des élèves`;
}

/** Lignes exploitables pour un établissement, triées */
export function examRows(exams, meta = {}) {
  if (!exams) return [];
  const out = [];
  for (const kind of ORDER) {
    const e = exams[kind];
    if (!e || !Number.isFinite(Number(e.t))) continue;
    const m = meta[kind] || {};
    out.push({
      kind,
      label: LABEL[kind] || kind,
      taux: Number(e.t),
      prec: Number.isFinite(Number(e.tp)) ? Number(e.tp) : null,
      va: Number.isFinite(Number(e.va)) ? Number(e.va) : null,
      mention: Number.isFinite(Number(e.m)) ? Number(e.m) : null,
      candidats: Number.isFinite(Number(e.n)) ? Number(e.n) : null,
      annee: m.annee ?? null,
      national: Number.isFinite(Number(m.national)) ? Number(m.national) : null,
    });
  }
  return out;
}

/** Bloc HTML détaillé — popup de la carte */
export function examHtml(exams, meta = {}) {
  const rows = examRows(exams, meta);
  if (!rows.length) return "";

  const items = rows.map(r => {
    const bits = [];
    if (r.national != null) bits.push(`national ${pct(r.national)}`);
    if (r.prec != null) {
      const d = r.taux - r.prec;
      const signe = d > 0 ? "+" : d < 0 ? "−" : "=";
      bits.push(`${r.annee ? r.annee - 1 : "an préc."} ${pct(r.prec)} (${signe}${Math.abs(d).toFixed(0)})`);
    }
    if (r.mention != null) bits.push(`mentions ${pct(r.mention)}`);
    if (r.candidats != null) bits.push(`${r.candidats} candidats`);

    const va = fmtVa(r.va);
    const badge = va === null ? ""
      : ` <span class="va ${vaClass(r.va)}" title="${esc(vaTitle(r.va))}">VA ${esc(va)}</span>`;

    return `<div class="exam-row">
      <span class="exam-label">${esc(r.label)}${r.annee ? " " + r.annee : ""}</span>
      <strong>${esc(pct(r.taux))}</strong>${badge}
      ${bits.length ? `<div class="exam-sub">${esc(bits.join(" • "))}</div>` : ""}
    </div>`;
  }).join("");

  return `<div class="exam-block">${items}</div>`;
}

/** Résumé compact d'une ligne — liste latérale */
export function examSummary(exams, meta = {}) {
  const rows = examRows(exams, meta);
  if (!rows.length) return null;
  const r = rows[0];
  const va = fmtVa(r.va);
  return {
    text: `${r.label} : ${pct(r.taux)}`,
    va,
    vaClass: vaClass(r.va),
    title: vaTitle(r.va),
  };
}

export default { examRows, examHtml, examSummary };
