#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusionne des sources IDFM + SNCF vers data/stations.min.json
et normalise: {name, mode, line?, lat, lon}

Usage:
  python3 scripts/build_stations_json.py \
      data/stations_source.geojson \
      data/sncf_gares.geojson \
      data/stations.min.json
"""

import json, sys, os, re
from collections import Counter

ALLOWED_MODES = {"metro","rer","tram","transilien","ter","tgv"}

# --- util JSON ---
def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

# --- GeoJSON helpers ---
def guess_latlon(geom):
    """Retourne (lat, lon) si geometry=Point."""
    if not isinstance(geom, dict): return None, None
    if geom.get("type") != "Point": return None, None
    coords = geom.get("coordinates") or []
    if len(coords) >= 2 and all(isinstance(x,(int,float)) for x in coords[:2]):
        lon, lat = coords[0], coords[1]
        return float(lat), float(lon)
    return None, None

def norm(s): return ("" if s is None else str(s)).strip()

# --- détection mode / ligne ---
def mode_key(s):
    """Texte -> {metro,rer,tram,transilien,ter,tgv} (ou None)."""
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

NAME_KEYS = [
    # SNCF fréquents
    "libelle_gare","nom_gare","nomlong","nom_long","appellation","appellation_longue",
    # IDFM / divers
    "name","nom","label","libelle","libellé","intitule","intitulé","stop_name",
    "nom_station","zdl_nom","nom_zdl","nom_commune","nom_de_la_gare","gare","station"
]
CITY_KEYS = ["commune","ville","city","localite","locality","arrondissement","commune_principale"]

LINE_KEYS = [
    "line","ligne","nom_ligne","code_ligne","ligne_long","ligne_nom","ligne_code",
    "indice_ligne","indice_lig","route_short_name","route_id","id_ligne","id_ref_ligne",
    "reseau_ligne","code","libelle_ligne"
]

def first_non_empty(o, keys):
    for k in keys:
        if k in o and o[k] not in (None,""):
            return o[k]
    return None

def clean_name(raw):
    s = norm(raw)
    if not s: return ""
    # enlève les préfixes/annot
    s = re.sub(r"\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+", "", s, flags=re.I)
    s = re.sub(r"^Gare\s+", "", s, flags=re.I)
    s = re.sub(r"\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*", " ", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*RER\s+[A-E]\b", "", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*Ligne\s+[A-Z0-9]+$", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s

def normalize_line(raw, mode):
    S = norm(raw).upper()
    if not S: return None
    m = re.search(r"\bRER\s*([A-E])\b", S)
    if m: return m.group(1)
    if mode == "metro":
        m = re.search(r"\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b", S)
        if m: return m.group(1)
        m = re.search(r"\b([37])\s*BIS\b", S)
        if m: return "3BIS" if m.group(1)=="3" else "7BIS"
    if mode == "tram":
        m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", S) or re.search(r"\bTRAM\s*([0-9]{1,2}[AB]?)\b", S)
        if m: return "T"+m.group(1).upper()
    if mode == "transilien":
        m = re.search(r"\b(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b", S) or re.search(r"\b([HJKLNRPU])\b", S)
        if m: return m.group(1)
    return None

def guess_mode_from_context(props_text, name_u, line_u, has_sncf_markers):
    if re.search(r"\bRER\b", name_u) or re.search(r"\bRER\b", line_u): return "rer"
    if re.search(r"\b(?:M|MÉTRO|METRO)\s*\d{1,2}\b", name_u) or "METRO" in line_u: return "metro"
    if re.search(r"\bT\s*\d{1,2}[AB]?\b", name_u) or "TRAM" in line_u: return "tram"
    if has_sncf_markers:
        if "TGV" in name_u or "TGV" in line_u: return "tgv"
        if "TER" in name_u or "INTERCIT" in name_u or "INTERCITÉ" in name_u: return "ter"
        return "transilien"
    # heuristique via texte props concaténé
    mk = mode_key(props_text)
    return mk

def extract_line_any(row, mode, raw_line, name_u):
    L = normalize_line(raw_line, mode)
    if L: return L
    # récup depuis nom si pas trouvé
    if mode == "rer":
        m = re.search(r"\bRER\s*([A-E])\b", name_u);  return m.group(1) if m else None
    if mode == "metro":
        m = re.search(r"\b(?:M|MÉTRO|METRO)\s*([0-9]{1,2})\b", name_u)
        if m: return m.group(1)
        m = re.search(r"\b([37])\s*BIS\b", name_u)
        if m: return "3BIS" if m.group(1)=="3" else "7BIS"
    if mode == "tram":
        m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", name_u)
        if m: return "T"+m.group(1).upper()
    if mode == "transilien":
        m = re.search(r"\b([HJKLNRPU])\b", name_u)
        if m: return m.group(1)
    return None

def props_text_blob(props):
    parts = []
    for k, v in (props or {}).items():
        if v is None: continue
        if isinstance(v, (list, tuple)): parts.extend([str(x) for x in v if x is not None])
        else: parts.append(str(v))
    return " ".join(parts).lower()

def from_feature_list(features):
    """Feature[] -> rows normalisées"""
    out = []
    for ft in features:
        if not isinstance(ft, dict): continue
        props = ft.get("properties") or {}
        lat, lon = guess_latlon(ft.get("geometry"))
        if lat is None or lon is None: continue

        # nom + ville
        raw_name = first_non_empty(props, NAME_KEYS)
        city = first_non_empty(props, CITY_KEYS)

        # mode direct
        mode_direct = mode_key(first_non_empty(props, ["mode","reseau","réseau","transport","network","mode_principal","type_transport"]))
        # indice SNCF ?
        has_sncf_marker = any(k in props for k in ("uic","code_uic","codeuic","voyageurs","idf_sncf","exploitant","gestionnaire"))
        # ligne brute
        raw_line = first_non_empty(props, LINE_KEYS)

        name_u = norm(raw_name).upper()
        line_u = norm(raw_line).upper()

        # si pas de mode, essaye via contexte
        if not mode_direct:
            mode_direct = guess_mode_from_context(
                props_text_blob(props).upper(), name_u, line_u, has_sncf_marker
            )

        # si toujours rien, on ne garde pas ce point
        if not mode_direct or mode_direct not in ALLOWED_MODES:
            continue

        # ligne
        line = extract_line_any(props, mode_direct, raw_line, name_u)

        # nom final propre
        name = clean_name(raw_name or "")
        if not name:
            # fallback
            if raw_name: name = norm(raw_name)
            if (not name or name.lower()=="gare") and city:
                name = f"Gare de {norm(city)}"
            if not name: name = "Gare"

        out.append({
            "name": name,
            "mode": mode_direct,
            "line": line,
            "lat": float(lat),
            "lon": float(lon),
        })
    return out

def load_any(path):
    """Lit un GeoJSON FeatureCollection, une liste de Features, ou une liste de rows."""
    data = load_json(path)
    if isinstance(data, list):
        if data and isinstance(data[0], dict) and "lat" in data[0] and "lon" in data[0]:
            return data
        if data and isinstance(data[0], dict) and "type" in data[0]:
            return from_feature_list(data)
    if isinstance(data, dict):
        if data.get("type") == "FeatureCollection" and isinstance(data.get("features"), list):
            return from_feature_list(data["features"])
        if "features" in data and isinstance(data["features"], list):
            return from_feature_list(data["features"])
    return []

def dedupe(rows, precision=5):
    """Déduplique grossièrement par (mode, line, lat/lon arrondis) pour garder une bulle par ligne."""
    seen = set()
    out = []
    for r in rows:
        key = (
            r.get("mode",""),
            (r.get("line") or "").upper(),
            round(float(r.get("lat",0)), precision),
            round(float(r.get("lon",0)), precision),
        )
        if key in seen: continue
        seen.add(key)
        out.append(r)
    return out

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

    # garde uniquement modes connus
    cleaned = [r for r in all_rows if r.get("mode") in ALLOWED_MODES]

    # seconde passe heuristique (si le mode est vide mais le nom dit TER/TGV)
    fix = []
    for r in all_rows:
        m = r.get("mode") or ""
        if m in ALLOWED_MODES:
            continue
        name_l = (r.get("name") or "").lower()
        if "tgv" in name_l or "grande vitesse" in name_l or "lgv" in name_l:
            r["mode"] = "tgv"; fix.append(r)
        elif "intercité" in name_l or "intercites" in name_l or "intercités" in name_l or "ter" in name_l:
            r["mode"] = "ter"; fix.append(r)
    cleaned.extend(fix)

    # dédoublonnage
    cleaned = dedupe(cleaned, precision=5)

    # pas de code de ligne pour TER/TGV
    for r in cleaned:
        if r["mode"] in ("ter","tgv"):
            r["line"] = r.get("line") or None

    # sauvegarde minifiée
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, separators=(",",":"))

    cnt = Counter([r.get("mode","") for r in cleaned])
    print(f"OK -> {out_path}  ({len(cleaned)} points)  par mode: {cnt}")

if __name__ == "__main__":
    main(sys.argv)
