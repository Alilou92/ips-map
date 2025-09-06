#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusionne des sources de stations (IDFM + SNCF) vers data/stations.min.json

Usage:
  python3 scripts/build_stations_json.py \
      data/stations_source.geojson \
      data/sncf_gares.geojson \
      data/stations.min.json

- Le(s) premier(s) fichier(s) sont les sources (GeoJSON ou JSON FeatureCollection)
- Le dernier argument est le fichier de sortie.

Le script tente d'inférer correctement:
  - le mode: metro / rer / tram / transilien / ter / tgv
  - la ligne: pour metro, rer, tram, transilien
"""

import json, sys, os, re
from collections import Counter

ALLOWED_MODES = {"metro","rer","tram","transilien","ter","tgv"}

# ────────────────────────── util ──────────────────────────

def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def guess_latlon(geom):
    """Retourne (lat, lon) depuis un GeoJSON Geometry (Point)."""
    if not geom: return None, None
    t = geom.get("type")
    if t == "Point":
        coords = geom.get("coordinates") or []
        if len(coords) >= 2 and all(isinstance(x,(int,float)) for x in coords[:2]):
            lon, lat = coords[0], coords[1]
            return float(lat), float(lon)
    # On ne gère pas les polygones: inutile pour les gares
    return None, None

def norm(s):
    return ("" if s is None else str(s)).strip()

def mode_key(s):
    """
    Normalise un texte → {metro,rer,tram,transilien,ter,tgv} ou None.
    """
    S = norm(s).lower()
    if not S: return None
    if S.startswith("met"): return "metro"
    if " rer" in S or S == "rer": return "rer"
    if S.startswith("tram") or re.search(r"\bt\d{1,2}[ab]?\b", S): return "tram"
    if "transilien" in S or "train" in S: return "transilien"
    if "intercité" in S or "intercites" in S or "intercités" in S: return "ter"
    if "ter" in S: return "ter"
    if "tgv" in S or "grande vitesse" in S or "lgv" in S: return "tgv"
    return None

def extract_line(props, mode):
    """
    Essaie d'extraire un code de ligne (quand pertinent).
    Retourne None si rien de fiable.
    """
    if not props: return None
    cands = [
        props.get("code_ligne"), props.get("ligne"), props.get("nom_ligne"),
        props.get("line"), props.get("code"),
        props.get("route_short_name"), props.get("route_id"),
        props.get("indice_ligne"), props.get("route"), props.get("reseau_ligne")
    ]
    for c in cands:
        if not c: continue
        s = str(c).strip().upper()

        if mode == "metro":
            m = re.search(r"(?:LIGNE|METRO|MÉTRO|M)?\s*([0-9]{1,2})\b", s)
            if m: return m.group(1)
            m = re.search(r"\b([37])\s*BIS\b", s)
            if m: return "3BIS" if m.group(1) == "3" else "7BIS"

        if mode == "rer":
            m = re.search(r"\b([A-E])\b", s)
            if m: return m.group(1)

        if mode == "tram":
            m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", s)
            if m: return "T" + m.group(1).upper()
            m = re.search(r"\bTRAM\s*([0-9]{1,2}[AB]?)\b", s)
            if m: return "T" + m.group(1).upper()

        if mode == "transilien":
            # "TRANSILIEN L", "LIGNE J", ou juste "J"
            m = re.search(r"(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b", s)
            if m: return m.group(1)
            m = re.search(r"\b([HJKLNRPU])\b", s)
            if m: return m.group(1)

    return None

def from_feature_list(features, source_hint=""):
    """
    Convertit une liste de Feature en lignes normalisées:
      {name, mode, line?, lat, lon}
    """
    out = []
    for ft in features:
        if not isinstance(ft, dict): continue
        props = ft.get("properties") or {}
        geom  = ft.get("geometry") or {}
        lat, lon = guess_latlon(geom)
        if lat is None or lon is None: continue

        # Détecter le mode
        mode = None

        # 1) champs directs
        for k in ("mode","reseau","réseau","transport","network","mode_principal","type_transport"):
            if k in props:
                mode = mode_key(props[k])
                if mode: break

        # 2) concat indices textuels (SNCF/IDFM)
        if not mode:
            hint_parts = []
            for k in (
                "services","service","type","categorie","catégorie","label","libelle",
                "libellé","intitule","intitulé","famille","famille_service","offre",
                "description", "discriminant"
            ):
                v = props.get(k)
                if v is None: continue
                if isinstance(v, (list, tuple)):
                    hint_parts.extend([str(x) for x in v if x is not None])
                else:
                    hint_parts.append(str(v))
            hint_text = " ".join(hint_parts)
            mode = mode_key(hint_text)

        # Nom
        name = (props.get("name") or props.get("nom") or props.get("label")
                or props.get("libelle") or props.get("libellé") or "Gare").strip()

        # Ligne si pertinent
        line = None
        if mode in ("metro","rer","tram","transilien"):
            line = extract_line(props, mode)

        row = {
            "name": name,
            "mode": mode or "",
            "line": line,
            "lat": float(lat),
            "lon": float(lon),
        }
        out.append(row)
    return out

def load_any(path):
    """
    Lit un GeoJSON (FeatureCollection) ou un JSON brut (liste de rows).
    """
    data = load_json(path)

    # Déjà au bon format ?
    if isinstance(data, list) and data and isinstance(data[0], dict) and "lat" in data[0] and "lon" in data[0]:
        return data

    # FeatureCollection ?
    if isinstance(data, dict) and data.get("type") == "FeatureCollection" and isinstance(data.get("features"), list):
        return from_feature_list(data["features"], source_hint=path)

    # Liste de Features bruts ?
    if isinstance(data, list) and data and isinstance(data[0], dict) and "type" in data[0]:
        return from_feature_list(data, source_hint=path)

    # Dernière chance
    if isinstance(data, dict) and "features" in data:
        return from_feature_list(data["features"], source_hint=path)

    return []

def dedupe(rows, precision=5):
    """Déduplique grossièrement par (mode, name, lat/lon arrondis)."""
    seen = set()
    out = []
    for r in rows:
        key = (r.get("mode",""), (r.get("name","") or "").lower(),
               round(float(r.get("lat",0)), precision),
               round(float(r.get("lon",0)), precision))
        if key in seen: continue
        seen.add(key)
        out.append(r)
    return out

# ────────────────────────── main ──────────────────────────

def main(argv):
    if len(argv) < 4:
        print("Usage: python3 scripts/build_stations_json.py <in1> [in2 ...] <out>")
        sys.exit(1)

    *ins, out_path = argv[1:]
    all_rows = []
    for p in ins:
        if not os.path.exists(p):
            print(f"ERREUR: fichier introuvable: {p}", file=sys.stderr)
            sys.exit(2)
        rows = load_any(p)
        all_rows.extend(rows)

    # Filtrage + heuristique SNCF pour TER/TGV au besoin
    cleaned = []
    for r in all_rows:
        m = (r.get("mode") or "").strip().lower()
        name_l = (r.get("name") or "").lower()

        if m in ALLOWED_MODES:
            cleaned.append(r)
            continue

        # Heuristique si mode absent: deviner TER/TGV depuis le nom
        if "tgv" in name_l or "grande vitesse" in name_l or "lgv" in name_l:
            r["mode"] = "tgv"
            cleaned.append(r)
        elif "intercité" in name_l or "intercites" in name_l or "intercités" in name_l or "ter" in name_l:
            r["mode"] = "ter"
            cleaned.append(r)
        # Sinon on ignore l'entrée (mode non fiable)

    # Dédupe
    cleaned = dedupe(cleaned, precision=5)

    # TER/TGV: pas de ligne par défaut
    for r in cleaned:
        if r.get("mode") in ("ter","tgv"):
            r["line"] = r.get("line") or None

    # Sauvegarde minifiée
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, separators=(",",":"))

    # Stats
    cnt = Counter([r.get("mode","") for r in cleaned])
    total = len(cleaned)
    print(f"OK -> {out_path}  ({total} points)  par mode: {cnt}")

if __name__ == "__main__":
    main(sys.argv)
