# ─────────────────────────────────────────────────────────────────────────────
# PATCH "build_stations.py" : découverte via data.gouv + support fichier local
# ─────────────────────────────────────────────────────────────────────────────
import os, json, datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DATAGOUV_DATASET_SLUG = os.environ.get(
    "DATAGOUV_DATASET_SLUG",
    "reseau-urbain-et-interurbain-dile-de-france-mobilites"
)

def http_get_json(url: str):
    req = Request(url, headers={"User-Agent": "ips-map-builder/1.0"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def discover_latest_idfm_zip_url_via_datagouv(slug: str) -> str | None:
    """
    Va chercher la dataset sur data.gouv.fr et extrait la ressource GTFS (zip)
    la plus récente. Retourne l'URL directe du fichier.
    """
    api = f"https://www.data.gouv.fr/api/1/datasets/{slug}/"
    try:
        data = http_get_json(api)
    except Exception as e:
        print(f"[data.gouv] Échec API dataset: {e}")
        return None

    resources = data.get("resources") or []
    candidates = []
    for res in resources:
        url = res.get("url") or ""
        fmt = (res.get("format") or "").lower()      # e.g. "zip", "gtfs", "GTFS"
        mime = (res.get("mime") or "").lower()       # e.g. "application/zip"
        title = (res.get("title") or "") + " " + (res.get("description") or "")
        title_l = title.lower()

        looks_like_gtfs = (
            "gtfs" in fmt or
            "gtfs" in mime or
            "gtfs" in title_l or
            url.lower().endswith(".zip") and ("gtfs" in url.lower() or "offre-transport" in url.lower())
        )
        is_zip = (fmt == "zip" or "zip" in mime or url.lower().endswith(".zip"))

        if url and is_zip and looks_like_gtfs:
            lm = res.get("last_modified") or res.get("created_at") or ""
            try:
                # data.gouv dates: "2025-09-06T12:34:56+00:00"
                dt = datetime.datetime.fromisoformat(lm.replace("Z", "+00:00"))
            except Exception:
                dt = datetime.datetime.min
            candidates.append((dt, url))

    if not candidates:
        print("[data.gouv] Aucune ressource GTFS zip trouvée sur le dataset.")
        return None

    candidates.sort(reverse=True, key=lambda t: t[0])
    best = candidates[0][1]
    print(f"[data.gouv] GTFS sélectionné : {best}")
    return best

def download_bytes(url_or_path: str) -> bytes:
    """
    Télécharge des octets depuis (a) une URL http(s) ou (b) un fichier local.
    - Gère les chemins avec ~ (expanduser)
    - Gère les URI file://
    """
    if not url_or_path:
        raise ValueError("URL/chemin vide")

    # 1) file://
    if url_or_path.startswith("file://"):
        local_path = os.path.expanduser(url_or_path[len("file://"):])
        with open(local_path, "rb") as f:
            return f.read()

    # 2) chemin local existant (avec ou sans ~)
    p = os.path.expanduser(url_or_path)
    if os.path.exists(p):
        with open(p, "rb") as f:
            return f.read()

    # 3) HTTP(S)
    req = Request(url_or_path, headers={"User-Agent": "ips-map-builder/1.0"})
    try:
        with urlopen(req, timeout=120) as r:
            return r.read()
    except HTTPError as e:
        raise RuntimeError(f"Téléchargement en échec ({e.code}) : {url_or_path}") from e
    except URLError as e:
        raise RuntimeError(f"Téléchargement en échec : {url_or_path} ({e})") from e
