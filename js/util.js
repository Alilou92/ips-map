// js/util.js — helpers partagés (normalisation + distances)

// Normalise : supprime les diacritiques, passe en minuscules, trim
export function strip(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// degrés → radians
export const deg2rad = (d) => (Number(d) * Math.PI) / 180;

// Distance haversine en mètres
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = deg2rad(lat1);
  const φ2 = deg2rad(lat2);
  const Δφ = deg2rad(lat2 - lat1);
  const Δλ = deg2rad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

// Petits utilitaires optionnels
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n)));
export const round1 = (n) => Math.round(Number(n) * 10) / 10;
