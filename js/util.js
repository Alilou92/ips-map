// js/util.js — helpers partagés (normalisation + distances)

// Normalise : enlève accents/diacritiques, met en minuscules et trim
export function strip(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Conversion degrés → radians
const deg2rad = (d) => (Number(d) * Math.PI) / 180;

// Distance haversine en mètres
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // rayon Terre
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

// Utilitaires
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n)));
export const round1 = (n) => Math.round(Number(n) * 10) / 10;
