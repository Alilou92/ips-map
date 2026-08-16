#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ─────────────────────────────────────────────────────────────────────────────
# build_stations.py
# Génère data/stations.min.json à partir d'un GTFS (IDFM) :
#  - Découverte auto via data.gouv.fr (dataset slug)
#  - Ou usage d'un fichier local / URL (env IDFM_GTFS_URL)
#  - Parse routes/stops/trips/stop_times pour associer chaque station aux lignes
#  - Déduit mode (métro, RER, tram, transilien, TER, TGV) + numéro/lettre
#  - Exporte: [{name, mode, line, lat, lon, colorHex?}, ...]
#
# Usage:
#   python3 scripts/build_stations.py
#   IDFM_GTFS_URL="~/Downloads/idfm-gtfs.zip" python3 scripts/build_stations.py
# ─────────────────────────────────────────────────────────────────────────────

import os
import re
import io
import csv
import sys
import json
import zipfile
import datetime
from collections import defaultdict
from typing import Dict, Set, Tuple, List, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ─────────────────────────────────────────────────────────────────────────────
# Découverte data.gouv + entrée forcée facultative
# ─────────────────────────────────────────────────────────────────────────────

DATAGOUV_DATASET_SLUG = os.environ.get(
    "DATAGOUV_DATASET_SLUG",
    "reseau-urbain-et-interurbain-dile-de-france-mobilites"
)
IDFM_GTFS_URL = os.environ.get("IDFM_GTFS_URL", "").strip()

def http_get_json(url: str):
    req = Request(url, headers={"User-Agent": "ips-map-builder/1.0"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def discover_latest_idfm_zip_url_via_datagouv(slug: str) -> Optional[str]:
    """Retourne l’URL de la ressource GTFS zip la plus récente d’un dataset data.gouv.fr."""
    api = f"https://www.data.gouv.fr/api/1/datasets/{slug}/"
    try:
        data = http_get_json(api)
    except Exception as e:
        print(f"[data.gouv] Échec API dataset: {e}")
        return None

    resources = data.get("resources") or []
    candidates: List[Tuple[datetime.datetime, str]] = []
    for res in resources:
        url = (res.get("url") or "").strip()
        fmt = (res.get("format") or "").lower()
        mime = (res.get("mime") or "").lower()
        title = ((res.get("title") or "") + " " + (res.get("description") or "")).lower()
        looks_like_gtfs = (
            "gtfs" in fmt or "gtfs" in mime or "gtfs" in title
            or (url.endswith(".zip") and ("gtfs" in url.lower() or "offre-transport" in url.lower()))
        )
        is_zip = (fmt == "zip" or "zip" in mime or url.endswith(".zip"))
        if url and is_zip and looks_like_gtfs:
            lm = res.get("last_modified") or res.get("created_at") or ""
            try:
                dt = datetime.datetime.fromisoformat(lm.replace("Z", "+00:00"))
            except Exception:
                dt = datetime.datetime.min
            candidates.append((dt, url))

    if not candidates:
        print("[data.gouv] Aucune ressource GTFS zip trouvée.")
        return None

    candidates.sort(reverse=True, key=lambda t: t[0])
    best = candidates[0][1]
    print(f"[data.gouv] GTFS sélectionné : {best}")
    return best

def download_bytes(url_or_path: str) -> bytes:
    """Télécharge depuis http(s) ou lit un fichier local (supporte file:// et ~)."""
    if not url_or_path:
        raise ValueError("URL/chemin vide")

    if url_or_path.startswith("file://"):
        p = os.path.expanduser(url_or_path[7:])
        with open(p, "rb") as f:
            return f.read()

    p = os.path.expanduser(url_or_path)
    if os.path.exists(p):
        with open(p, "rb") as f:
            return f.read()

    req = Request(url_or_path, headers={"User-Agent": "ips-map-builder/1.0"})
    try:
        with urlopen(req, timeout=120) as r:
            return r.read()
    except HTTPError as e:
        raise RuntimeError(f"Téléchargement en échec ({e.code}) : {url_or_path}") from e
    except URLError as e:
        raise RuntimeError(f"Téléchargement en échec : {url_or_path} ({e})") from e

# ─────────────────────────────────────────────────────────────────────────────
# Couleurs (fallback si route_color absent)
# ─────────────────────────────────────────────────────────────────────────────

# Palette officielle IDFM, relevée dans routes.txt du GTFS (route_color).
# Elle ne sert que de secours : route_color prime toujours (cf. color_for).
METRO_COLORS = {
    "1":"#FFBE00","2":"#0055C8","3":"#6E6E00","3BIS":"#82C8E6","4":"#A0006E",
    "5":"#FF5A00","6":"#82DC73","7":"#FF82B4","7BIS":"#82DC73","8":"#D282BE",
    "9":"#D2D200","10":"#DC9600","11":"#6E491E","12":"#00643C","13":"#82C8E6","14":"#640082"
}
RER_COLORS = {"A":"#EB2132","B":"#5091CB","C":"#FFCC30","D":"#008B5B","E":"#B94E9A"}
TRAM_COLORS = {
    "T1":"#0055C8","T2":"#A0006E","T3A":"#FF5A00","T3B":"#00643C","T4":"#DC9600",
    "T5":"#640082","T6":"#FF0000","T7":"#6E491E","T8":"#6E6E00","T9":"#3C91DC",
    "T10":"#6E6E00","T11":"#FF5A00","T12":"#A50034","T13":"#8D653D","T14":"#00A092",
    "ORLYVAL":"#5EC5ED","CDGVAL":"#5CC5ED"
}
TRANSILIEN_COLORS = {"H":"#84653D","J":"#CEC73D","K":"#9B9842","L":"#C4A4CC","N":"#00B297","P":"#F58F53","R":"#F49FB3","U":"#B6134C"}

# TER et grandes lignes : deux teintes volontairement absentes de la palette
# IDFM. Le magenta du TGV était à un ΔE de 2 du métro 4, et le gris du TER se
# confondait avec le « gris = IPS non publié » de la légende.
DEFAULT_BY_MODE = {
    "metro":"#0055C8","rer":"#5091CB","tram":"#00A092","transilien":"#84653D","ter":"#0F4C5C","tgv":"#0A2A5E"
}

def color_for(mode: str, line: Optional[str], color_hex: Optional[str]) -> Optional[str]:
    if color_hex:
        return color_hex
    m = (mode or "").lower()
    l = (line or "").upper()
    if m == "metro":      return METRO_COLORS.get(l.lstrip("0")) or DEFAULT_BY_MODE["metro"]
    if m == "rer":        return RER_COLORS.get(l)              or DEFAULT_BY_MODE["rer"]
    if m == "tram":       return TRAM_COLORS.get(l if l.startswith("T") else f"T{l}") or DEFAULT_BY_MODE["tram"]
    if m == "transilien": return TRANSILIEN_COLORS.get(l)       or DEFAULT_BY_MODE["transilien"]
    if m == "ter":        return DEFAULT_BY_MODE["ter"]
    if m == "tgv":        return DEFAULT_BY_MODE["tgv"]
    return None

# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires parsing & normalisation
# ─────────────────────────────────────────────────────────────────────────────

def parse_color_hex(s: str) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r"^#?([0-9A-Fa-f]{6})$", s)
    if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^0x([0-9A-Fa-f]{6})$", s)
    if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", s, re.I)
    if m:
        def to2(x: str) -> str:
            v = max(0, min(255, int(x))); return f"{v:02X}"
        return f"#{to2(m.group(1))}{to2(m.group(2))}{to2(m.group(3))}"
    return None

def norm_name(raw: str) -> str:
    s = (raw or "").strip()
    if not s: return "Gare"
    s = re.sub(r"\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+", "", s, flags=re.I)
    s = re.sub(r"^Gare\s+", "", s, flags=re.I)
    s = re.sub(r"\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*", " ", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*RER\s+[A-E]\b", "", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*Ligne\s+[A-Z0-9]+$", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s or "Gare"

def normalize_line(raw: str, mode: str) -> Optional[str]:
    if not raw: return None
    S = str(raw).upper()
    m = re.search(r"\bRER\s*([A-E])\b", S)
    if m: return m.group(1)
    if mode == "metro":
        m = re.search(r"\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b", S)
        if m: return m.group(1)
        m = re.search(r"\b([37])\s*BIS\b", S)
        if m: return "3BIS" if m.group(1) == "3" else "7BIS"
    if mode == "tram":
        m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", S)
        if m: return f"T{m.group(1)}"
        m = re.search(r"\bTRAM\s*([0-9]{1,2}[AB]?)\b", S)
        if m: return f"T{m.group(1)}"
    if mode == "transilien":
        m = re.search(r"\b(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b", S)
        if m: return m.group(1)
        m = re.search(r"\b([HJKLNRPU])\b", S)
        if m: return m.group(1)
    return None

def normalize_line_from_short(mode: str, short_name: str) -> Optional[str]:
    s = (short_name or "").upper().strip()
    if not s: return None
    if mode == "metro":
        # le GTFS IDFM nomme les bis "3B" / "7B" — à traiter avant le cas numérique
        m = re.match(r"^(?:M)?\s*(3|7)\s*(?:BIS|B)$", s)
        if m: return "3BIS" if m.group(1) == "3" else "7BIS"
        m = re.match(r"^(?:M)?\s*0*([0-9]{1,2})$", s)
        if m: return m.group(1)
    if mode == "tram":
        # navettes automatiques des aéroports : "ORLYVAL", "CDG VAL"
        if "VAL" in s:
            return "ORLYVAL" if "ORLY" in s else ("CDGVAL" if "CDG" in s else s.replace(" ", ""))
        m = re.match(r"^(?:T)?\s*([0-9]{1,2}[AB]?)$", s)
        if m: return f"T{m.group(1)}"
    if mode == "rer":
        m = re.match(r"^[A-E]$", s)
        if m: return m.group(0)
    if mode == "transilien":
        m = re.match(r"^[HJKLNRPU]$", s)
        if m: return m.group(0)
    return None

def deduce_mode_from_route(route_type: str, short_name: str, long_name: str = "") -> Optional[str]:
    """
    Règles solides :
    - On ÉCARTE d’abord les BUS (route_type == 3).
    - RER/métro/tram/transilien reconnus par motifs + types GTFS quand ils sont fiables.
    - On ne force plus "transilien" par défaut sur route_type=2 si on n’a aucun motif.
    """
    rt = str(route_type or "").strip()
    if rt == "3":  # BUS → on ignore
        return None

    s = (short_name or "").upper().strip()
    l = (long_name  or "").upper().strip()

    # Motifs explicites
    if re.fullmatch(r"[A-E]", s) or "RER" in l:
        return "rer"
    if "TRAM" in l or re.search(r"\bT\s*\d", l):
        return "tram"
    if re.fullmatch(r"[HJKLNRPU]", s) or "TRANSILIEN" in l:
        return "transilien"
    if "TGV" in s or "TGV" in l:
        return "tgv"
    if "TER" in s or "TER" in l:
        return "ter"
    # Métro : seulement si type subway (1) ou motif clair "M/METRO"
    if rt == "1" or re.match(r"^(?:M|METRO|MÉTRO)\s*(\d{1,2}|3BIS|7BIS)$", s):
        return "metro"
    # Tram si type 0
    if rt == "0":
        return "tram"
    # Rail (2) mais sans motif → on ne classe pas
    if rt == "2":
        return None

    return None

# ─────────────────────────────────────────────────────────────────────────────
# Lecture GTFS (routes, stops, trips, stop_times)
# ─────────────────────────────────────────────────────────────────────────────

def read_csv_from_zip(zf: zipfile.ZipFile, names: List[str]) -> Optional[List[Dict[str, str]]]:
    namemap = {n.lower(): n for n in zf.namelist()}
    for cand in names:
        if cand.lower() in namemap:
            with zf.open(namemap[cand.lower()], "r") as f:
                data = f.read().decode("utf-8", errors="replace")
            return [row for row in csv.DictReader(io.StringIO(data))]
    return None

def build_station_entries_from_gtfs(gtfs_bytes: bytes) -> List[Dict[str, object]]:
    zf = zipfile.ZipFile(io.BytesIO(gtfs_bytes), "r")

    # routes
    routes_rows = read_csv_from_zip(zf, ["routes.txt"]) or []
    routes: Dict[str, Dict[str, str]] = {}
    for r in routes_rows:
        rid = (r.get("route_id") or "").strip()
        if not rid: continue
        routes[rid] = {
            "short": (r.get("route_short_name") or "").strip(),
            "long":  (r.get("route_long_name")  or "").strip(),
            "type":  (r.get("route_type")       or "").strip(),
            "color": (r.get("route_color")      or "").strip(),
        }

    # stops (stations & enfants)
    stops_rows = read_csv_from_zip(zf, ["stops.txt"]) or []
    stops: Dict[str, Dict[str, str]] = {}
    parent_of: Dict[str, str] = {}
    children_of: Dict[str, List[str]] = defaultdict(list)
    station_ids: Set[str] = set()

    for s in stops_rows:
        sid = (s.get("stop_id") or "").strip()
        if not sid: continue
        stops[sid] = s
    for sid, s in stops.items():
        loc_type = (s.get("location_type") or "").strip()
        parent = (s.get("parent_station") or "").strip()
        if parent:
            parent_of[sid] = parent
            children_of[parent].append(sid)
        if loc_type == "1":
            station_ids.add(sid)

    # trips
    trips_rows = read_csv_from_zip(zf, ["trips.txt"]) or []
    trip_to_route: Dict[str, str] = {}
    for t in trips_rows:
        tid = (t.get("trip_id") or "").strip()
        rid = (t.get("route_id") or "").strip()
        if tid and rid:
            trip_to_route[tid] = rid

    # stop_times → stop ↔ routes
    stop_to_routes: Dict[str, Set[str]] = defaultdict(set)
    st_rows = read_csv_from_zip(zf, ["stop_times.txt"]) or []
    for st in st_rows:
        sid = (st.get("stop_id") or "").strip()
        tid = (st.get("trip_id") or "").strip()
        if not sid or not tid: continue
        rid = trip_to_route.get(tid)
        if rid: stop_to_routes[sid].add(rid)

    # Union des routes au niveau station (parent); si rien → garde la station mais sans routes
    station_routes: Dict[str, Set[str]] = defaultdict(set)
    for sid in stops.keys():
        dest = None
        if sid in parent_of:
            p = parent_of[sid]
            if (stops.get(p, {}).get("location_type") or "") == "1":
                dest = p
        elif sid in station_ids:
            dest = sid
        if not dest: dest = sid  # stop isolé → station par défaut

        if sid in stop_to_routes:
            station_routes[dest].update(stop_to_routes[sid])

    for stid in station_ids:
        station_routes.setdefault(stid, set())

    # Construire les entrées finales
    out: List[Dict[str, object]] = []
    seen: Set[Tuple[str, str, Optional[str], float, float]] = set()

    for stid, route_ids in station_routes.items():
        s = stops.get(stid, {})
        # coords station ou 1er enfant
        lat = s.get("stop_lat") or s.get("stop_lat_wgs84") or s.get("lat") or ""
        lon = s.get("stop_lon") or s.get("stop_lon_wgs84") or s.get("lon") or ""
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            lat = lon = None
            for child in children_of.get(stid, []):
                sc = stops.get(child, {})
                try:
                    lat = float(sc.get("stop_lat") or "")
                    lon = float(sc.get("stop_lon") or "")
                    break
                except Exception:
                    continue
            if lat is None or lon is None:
                continue

        raw_name = s.get("stop_name") or s.get("stop_desc") or s.get("name") or ""
        name = norm_name(raw_name)

        if not route_ids:
            # aucune route → on ignore (évite des points « bleus » sans ligne)
            continue

        for rid in sorted(route_ids):
            r = routes.get(rid, {})
            mode = deduce_mode_from_route(r.get("type"), r.get("short"), r.get("long"))
            if mode is None:
                continue  # on ne retient pas les bus/indéterminés

            # ligne + couleur
            line  = normalize_line_from_short(mode, r.get("short")) or normalize_line(r.get("long"), mode)
            color = parse_color_hex(r.get("color") or "")
            color = color_for(mode, line, color)

            entry = {"name": name, "mode": mode, "line": line, "lat": lat, "lon": lon}
            if color: entry["colorHex"] = color

            key = (entry["name"], entry["mode"], entry["line"], entry["lat"], entry["lon"])
            if key not in seen:
                seen.add(key)
                out.append(entry)

    return out

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

# GTFS national SNCF (TER, Intercités, TGV). Le flux IDFM s'arrête aux frontières
# de l'Île-de-France : sans celui-ci, Le Mans, Lyon ou Bordeaux n'ont aucune gare.
SNCF_GTFS_URL = os.environ.get(
    "SNCF_GTFS_URL",
    "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
)

# Les agences du flux SNCF sont toutes « SNCF Voyageurs » : le service se lit sur
# le code de ligne. Les dessertes grande ligne portent un numéro à 3 chiffres
# (401D Paris-Rennes, 631B Paris-Marseille), les TER une lettre suivie d'un
# nombre (P5, K39, C30).
_GRANDE_LIGNE_RE = re.compile(r"^\d{3}[A-Z]?$", re.I)

def sncf_mode(short_name: str, long_name: str) -> Optional[str]:
    s = (short_name or "").strip().upper()
    l = (long_name or "").strip().upper()
    if "TGV" in l or "TGV" in s:
        return "tgv"
    if _GRANDE_LIGNE_RE.match(s):
        return "tgv"          # grandes lignes : TGV et Intercités confondus
    return "ter"

def build_sncf_entries(gtfs_bytes: bytes) -> List[Dict[str, object]]:
    """Gares SNCF nationales, une entrée par (gare, mode).

    Volontairement pas une entrée par ligne : Le Mans est desservi par 37
    routes, ce qui donnerait 37 marqueurs superposés sans rien apprendre.
    """
    zf = zipfile.ZipFile(io.BytesIO(gtfs_bytes))
    routes = {r["route_id"]: r for r in read_csv_from_zip(zf, ["routes.txt"]) or []}
    stops = {s["stop_id"]: s for s in read_csv_from_zip(zf, ["stops.txt"]) or []}
    trips = {t["trip_id"]: t for t in read_csv_from_zip(zf, ["trips.txt"]) or []}

    # mode(s) desservant chaque zone d'arrêt
    modes_par_gare: Dict[str, Set[str]] = defaultdict(set)
    for st in read_csv_from_zip(zf, ["stop_times.txt"]) or []:
        t = trips.get(st.get("trip_id"))
        if not t:
            continue
        r = routes.get(t.get("route_id"))
        if not r or str(r.get("route_type", "")).strip() != "2":   # 2 = ferroviaire
            continue
        sid = st.get("stop_id")
        s = stops.get(sid)
        if not s:
            continue
        gare = s.get("parent_station") or sid                       # remonte à la zone
        m = sncf_mode(r.get("route_short_name"), r.get("route_long_name"))
        if m:
            modes_par_gare[gare].add(m)

    out = []
    for gare, modes in modes_par_gare.items():
        s = stops.get(gare)
        if not s:
            continue
        try:
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        except (TypeError, ValueError, KeyError):
            continue
        nom = norm_name(s.get("stop_name"))
        for m in sorted(modes):
            out.append({"name": nom, "mode": m, "line": None, "lat": lat, "lon": lon,
                        "colorHex": DEFAULT_BY_MODE[m]})
    return out

BAN_REVERSE_CSV = "https://api-adresse.data.gouv.fr/reverse/csv/"

def add_communes(entries: List[Dict[str, object]]) -> int:
    """Ajoute commune / code postal / département à chaque station.

    Le GTFS ne porte aucune indication de localité : on géocode donc à l'envers
    via la BAN, en un seul appel groupé. Utile pour qui ne connaît pas la région
    et cherche « où est cette gare » — à Paris on récupère bien l'arrondissement
    (Abbesses -> 75018) et pas un code générique.

    En cas d'échec réseau on ne bloque pas le build : les stations sortent
    simplement sans ces champs.
    """
    # une seule interrogation par point distinct
    points = sorted({(round(float(e["lat"]), 6), round(float(e["lon"]), 6)) for e in entries})
    print(f"Géocodage inverse de {len(points)} points via la BAN…")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["lat", "lon"])
    for lat, lon in points:
        w.writerow([lat, lon])
    payload = buf.getvalue().encode("utf-8")

    boundary = "----ipsmapboundary"
    parts = []
    for col in ("result_city", "result_postcode", "result_context"):
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="result_columns"\r\n\r\n{col}\r\n'.encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="data"; filename="p.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n".encode() + payload + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    try:
        req = Request(BAN_REVERSE_CSV, data=body, headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "ips-map-builder/1.0",
        })
        with urlopen(req, timeout=300) as r:
            text = r.read().decode("utf-8")
    except Exception as e:
        print(f"  (BAN) échec, stations sans commune : {e}")
        return 0

    loc = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            key = (round(float(row["lat"]), 6), round(float(row["lon"]), 6))
        except (TypeError, ValueError, KeyError):
            continue
        ville = (row.get("result_city") or "").strip()
        cp = (row.get("result_postcode") or "").strip()
        # result_context = "94, Val-de-Marne, Île-de-France"
        ctx = [p.strip() for p in (row.get("result_context") or "").split(",")]
        dep = ctx[0] if ctx and ctx[0] else ""
        if ville or cp:
            loc[key] = {"commune": ville, "cp": cp, "dep": dep}

    # Rattrapage : la BAN cherche une *adresse* proche et ne répond rien pour une
    # gare posée au milieu des voies (Le Mans, Aix-en-Provence TGV…). L'API géo
    # répond, elle, par la commune qui contient le point.
    manquants = [p for p in points if p not in loc]
    if manquants:
        print(f"  {len(manquants)} points sans adresse proche, reprise via geo.api.gouv.fr…")
        rattrapes = 0
        for lat, lon in manquants:
            try:
                url = (f"https://geo.api.gouv.fr/communes?lat={lat}&lon={lon}"
                       f"&fields=nom,codesPostaux,codeDepartement&format=json")
                req = Request(url, headers={"User-Agent": "ips-map-builder/1.0"})
                with urlopen(req, timeout=30) as r:
                    arr = json.loads(r.read().decode("utf-8"))
            except Exception:
                continue
            if not arr:
                continue          # hors de France : gares allemandes, espagnoles…
            c = arr[0]
            cps = c.get("codesPostaux") or []
            loc[(lat, lon)] = {
                "commune": c.get("nom") or "",
                "cp": cps[0] if cps else "",
                "dep": c.get("codeDepartement") or "",
            }
            rattrapes += 1
        print(f"  -> {rattrapes} rattrapées")

    n = 0
    for e in entries:
        v = loc.get((round(float(e["lat"]), 6), round(float(e["lon"]), 6)))
        if not v:
            continue
        if v["commune"]: e["commune"] = v["commune"]
        if v["cp"]:      e["cp"] = v["cp"]
        if v["dep"]:     e["dep"] = v["dep"]
        n += 1
    print(f"  -> {n}/{len(entries)} stations localisées")
    return n

def main() -> int:
    print("Téléchargement GTFS IDFM…")
    url = IDFM_GTFS_URL or discover_latest_idfm_zip_url_via_datagouv(DATAGOUV_DATASET_SLUG)
    if not url:
        print("Impossible de découvrir la dernière archive GTFS IDFM (essais API data.gouv).")
        return 2

    try:
        gtfs_bytes = download_bytes(url)
    except Exception as e:
        print(f"Téléchargement impossible: {e}")
        return 3

    print("Parsing GTFS IDFM…")
    try:
        entries = build_station_entries_from_gtfs(gtfs_bytes)
    except Exception as e:
        print("Erreur pendant le parsing GTFS:", e)
        return 4
    print(f"  -> {len(entries)} entrées Île-de-France")

    # Couverture nationale : le flux IDFM ignore tout ce qui sort de la région.
    # Les TER franciliens qu'il contenait sont remplacés par ceux du flux SNCF,
    # plus complets et cohérents avec le reste du pays.
    try:
        print("Téléchargement GTFS national SNCF…")
        sncf = build_sncf_entries(download_bytes(SNCF_GTFS_URL))
        entries = [e for e in entries if e.get("mode") not in ("ter", "tgv")]
        vus = {(e["mode"], round(e["lat"], 4), round(e["lon"], 4)) for e in entries}
        ajoutees = 0
        for e in sncf:
            k = (e["mode"], round(e["lat"], 4), round(e["lon"], 4))
            if k in vus:
                continue
            vus.add(k); entries.append(e); ajoutees += 1
        print(f"  -> {ajoutees} gares SNCF ajoutées (TER + grandes lignes)")
    except Exception as e:
        print(f"  (SNCF) échec, couverture limitée à l'Île-de-France : {e}")

    add_communes(entries)

    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.abspath(os.path.join(here, "..", "data", "stations.min.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    entries.sort(key=lambda x: (
        str(x.get("name") or ""),
        str(x.get("mode") or ""),
        str(x.get("line") or ""),
        x.get("lat") or 0.0, x.get("lon") or 0.0
    ))

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK → {out_path} ({len(entries)} enregistrements)")
    print("Astuce: recharge la page avec ?bust=… et aligne DATA_VERSION dans js/stations.js")
    return 0

if __name__ == "__main__":
    sys.exit(main())
