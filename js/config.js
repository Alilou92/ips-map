// js/config.js (v=18)
// API search v1.0
export const BASE = "https://data.education.gouv.fr/api/records/1.0/search/";

// Annuaire géolocalisé (lat/lon + UAI)
export const DS_GEO = "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre";

// Jeux IPS (dernières éditions connues)
export const DS_IPS = {
  ecole:   "fr-en-ips-ecoles-ap2022",
  college: "fr-en-ips-colleges-ap2023",
  lycee:   "fr-en-ips-lycees-ap2023"
};

// API Explore v2.1 (uniquement pour WHERE IN (liste d'UAI))
export const EXPLORE_BASE = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/";
