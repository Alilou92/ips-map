// js/secteur.js — collège de secteur pour une adresse (carte scolaire MENJ)
//
// La carte scolaire nationale fait 520 000 tronçons de voie : impossible à
// charger d'un bloc. tools/build.py la découpe par département, et on ne
// télécharge que celui de l'adresse cherchée (moins de 750 Ko dans le pire cas).
//
// Deux formes dans la source :
//   • secteur unique  -> toute la commune dépend d'un collège
//   • sinon           -> tronçons "du n° X au n° Y, côté pair / impair"
//
// Limites assumées : collèges PUBLICS uniquement (le privé n'est pas sectorisé),
// et 4 départements manquent à la source — 17, 22, 2A et 2B.

const DATA_VERSION = "1";

const MANQUANTS = new Set(["17", "22", "2A", "2B"]);

/** Même normalisation que norm_voie() côté build : sans accents, majuscules,
    ponctuation en espaces. "Passage de l'École" -> "PASSAGE DE L ECOLE". */
export function normVoie(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normDep(d) {
  const s = String(d ?? "").trim().toUpperCase();
  if (s === "2A" || s === "2B") return s;
  if (/^\d{3}$/.test(s) && s.startsWith("0")) return s.slice(1).padStart(2, "0");
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  return s;
}

const _cache = new Map();   // dep -> Promise<data|null>

function load(dep) {
  const d = normDep(dep);
  if (!d) return Promise.resolve(null);
  if (!_cache.has(d)) {
    _cache.set(d, fetch(`./data/secteur/${d}.min.json?v=${DATA_VERSION}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return _cache.get(d);
}

/** Le numéro tombe-t-il dans le tronçon ? */
function dansTroncon(num, [deb, fin, par]) {
  if (num == null) return deb == null && fin == null;   // sans numéro : voie entière
  if (par === "P" && num % 2 !== 0) return false;
  if (par === "I" && num % 2 === 0) return false;
  if (deb != null && num < deb) return false;
  if (fin != null && num > fin) return false;
  return true;
}

/**
 * Cherche le collège de secteur.
 * @param {{street,housenumber,citycode,dep}} addr — adresse structurée de la BAN
 * @returns {Promise<{uai, exact, motif} | null>}
 *   exact = true si le tronçon correspond au numéro, false si c'est une
 *   déduction (voie entière, ou commune à collège unique).
 */
export async function collegeDeSecteur(addr) {
  if (!addr || !addr.citycode) return null;
  const dep = normDep(addr.dep || addr.citycode.slice(0, 2));
  if (MANQUANTS.has(dep)) return { indisponible: true, dep };

  const data = await load(dep);
  if (!data) return null;

  const insee = String(addr.citycode);
  const num = addr.housenumber != null ? parseInt(String(addr.housenumber), 10) : null;

  // 1) tronçon de voie
  const voies = data.voies?.[insee];
  const key = normVoie(addr.street);
  if (voies && key && voies[key]) {
    const troncons = voies[key];
    const n = Number.isFinite(num) ? num : null;

    // tous les tronçons qui couvrent ce numéro, pas seulement le premier :
    // ~2,4 % des voies sont rattachées à plusieurs collèges sur la même plage
    // (secteurs à choix), et masquer le second serait mentir.
    const hits = [...new Set(troncons.filter(t => dansTroncon(n, t)).map(t => t[3]))];
    if (hits.length === 1) return { uai: data.uai[hits[0]], exact: num != null, motif: "voie" };
    if (hits.length > 1) {
      return { ambigu: true, choix: hits.map(i => data.uai[i]), motif: "voie-partagee" };
    }

    // numéro hors des tronçons connus : si la voie entière ne dessert qu'un
    // collège, la réponse ne fait aucun doute
    const uniques = [...new Set(troncons.map(t => t[3]))];
    if (uniques.length === 1) {
      return { uai: data.uai[uniques[0]], exact: false, motif: "voie-unique" };
    }
    return { ambigu: true, choix: uniques.map(i => data.uai[i]), motif: "voie-multiple" };
  }

  // 2) commune à secteur unique
  const iu = data.uniq?.[insee];
  if (iu != null) return { uai: data.uai[iu], exact: false, motif: "commune" };

  // 3) rue inconnue mais la commune n'a qu'un collège de secteur au total
  if (voies) {
    const tous = new Set();
    for (const list of Object.values(voies)) for (const t of list) tous.add(t[3]);
    if (tous.size === 1) {
      return { uai: data.uai[[...tous][0]], exact: false, motif: "commune-unique" };
    }
  }
  return null;
}

export default { collegeDeSecteur, normVoie };
