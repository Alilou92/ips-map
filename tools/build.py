#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Build local data files for IPS Map
# Sorties:
#   data/establishments.min.json  -> [{uai,type,secteur,lat,lon,dep,cp,commune,name}]
#   data/ips.min.json             -> { "<UAI>": <IPS> }
#   data/gazetteer.min.json       -> [{name,cps[],lat,lon,dep?}]
#   data/stations.min.json        -> [{name,type,mode,line?,lat,lon}]

import json, time, unicodedata, urllib.request, gzip, os, re, csv, io, math
BASE_EXPLORE = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
DS_GEO = "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre"
# n'exporter que les établissements en service (etat_etablissement_libe == "OUVERT")
KEEP_ONLY_OPEN = True
DS_IPS = {
    "ecole":   "fr-en-ips-ecoles-ap2022",
    "college": "fr-en-ips-colleges-ap2023",
    "lycee":   "fr-en-ips-lycees-ap2023",
}
GEO_COMMUNES = "https://geo.api.gouv.fr/communes?fields=centre,nom,code,codesPostaux&format=json&geometry=centre"

# ---------- Résultats aux examens (brevet / bac) ----------
# Chaque source porte le taux de réussite ET la "valeur ajoutée" : l'écart entre
# le résultat obtenu et celui attendu compte tenu du profil social des élèves.
# C'est la VA qui distingue un bon établissement d'un établissement à bon public.
# nombre de sessions retenues pour moyenner la valeur ajoutée
SESSIONS_VA = 4

DS_EXAMS = {
    "brevet": {
        "dataset": "fr-en-indicateurs-valeur-ajoutee-colleges",
        "annee":   "session",
        "taux":    "taux_de_reussite_g",
        "va":      "va_du_taux_de_reussite_g",
        "n":       "nb_candidats_g",
        "mention": None,
        "libelle": "Brevet",
    },
    "bac_gt": {
        "dataset": "fr-en-indicateurs-de-resultat-des-lycees-gt_v2",
        "annee":   "annee",
        "taux":    "taux_reu_total",
        "va":      "va_reu_total",
        "n":       "presents_total",
        "mention": "taux_men_total",
        "libelle": "Bac général et technologique",
    },
    "bac_pro": {
        "dataset": "fr-en-indicateurs-de-resultat-des-lycees-pro_v2",
        "annee":   "annee",
        "taux":    "taux_reu_total",
        "va":      "va_reu_total",
        "n":       "presents_total",
        "mention": "taux_men_total",
        "libelle": "Bac professionnel",
    },
}

# ---------- IDFM gares/stations ----------
IDFM_DATASET = "emplacement-des-gares-idf"
IDFM_RECORDS = (
    f"https://data.iledefrance-mobilites.fr/api/explore/v2.1/"
    f"catalog/datasets/{IDFM_DATASET}/records?limit=50000"
)
IDFM_DOWNLOAD = (
    f"https://data.iledefrance-mobilites.fr/explore/dataset/{IDFM_DATASET}/"
    f"download/?format=geojson&timezone=UTC&lang=fr&epsg=4326"
)
IDFM_EXPORT = (
    f"https://data.iledefrance-mobilites.fr/explore/dataset/{IDFM_DATASET}/"
    f"exports/geojson?epsg=4326"
)

LOCAL_STATIONS_SOURCE = "data/stations_source.geojson"  # optionnel: si présent, on l'utilise

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36 ips-map-builder/1.7 (+https://github.com/Alilou92/ips-map)")

# ---------------- HTTP utils ----------------
def _fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, application/geo+json;q=0.9, */*;q=0.1",
            "Accept-Encoding": "gzip",
            "Referer": "https://data.iledefrance-mobilites.fr/",
        },
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return raw

def get_json(url: str):
    raw = _fetch_bytes(url)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return json.loads(raw)

def load_local_json(path: str):
    with open(path, "rb") as f:
        raw = f.read()
    return json.loads(raw.decode("utf-8"))

# ---------------- text helpers ----------------
def ascii_lower(s):
    if s is None: return ""
    if not isinstance(s, str): s = str(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.lower().strip()

def pick_ci(d, *names):
    if not isinstance(d, dict): return None
    low = {k.lower(): v for k, v in d.items()}
    for n in names:
        v = low.get(n.lower())
        if v not in (None, ""): return v
    return None

# ---------------- MENJ: établissements/IPS/communes ----------------
def export_json(dataset_id):   return get_json(f"{BASE_EXPLORE}{dataset_id}/exports/json")
def export_geojson(dataset_id):return get_json(f"{BASE_EXPLORE}{dataset_id}/exports/geojson?epsg=4326")

def derive_dep(cp, insee):
    if isinstance(cp, str) and cp.isdigit():
        return cp[:3] if cp.startswith(("97","98")) else cp[:2]
    if isinstance(insee, str):
        if insee.startswith(("2A","2B")): return insee[:2]
        if insee.startswith(("97","98")): return insee[:3]
        return insee[:2]
    return ""

def nature_to_type(nat):
    s = ascii_lower(nat)
    if "ecole" in s or "école" in s:     return "ecole"
    if "college" in s or "collège" in s: return "college"
    if "lycee" in s or "lycée" in s:     return "lycee"
    return None

def canon_sector(val):
    if val in (1, "1"): return "Public"
    if val in (2, "2"): return "Privé"
    s = ascii_lower(val)
    if not s: return "—"
    if "pub"  in s: return "Public"
    if "priv" in s: return "Privé"
    return "—"

# Le champ réel de l'annuaire est "secteur_public_prive_libe" — il doit rester en tête.
SECTOR_KEYS = [
    "secteur_public_prive_libe","secteur","statut_public_prive","secteur_public_prive","public_prive",
    "statut","statut_uai","secteur_uai","secteur_d_etablissement","secteur_etablissement",
    "type_contrat","contrat_etablissement","nature_secteur",
]

def sector_from_props(props):
    """Secteur depuis les champs déclarés uniquement.

    Surtout pas de repli « premier champ contenant pub/priv » : il lisait le nom
    de l'établissement et se trompait (LP Charles *Privat* -> Privé, écoles
    « privées » de Wallis-et-Futuna qui sont publiques). Sans champ fiable on
    renvoie "—", que l'app affiche tel quel.
    """
    for k in SECTOR_KEYS:
        v = pick_ci(props, k)
        if v not in (None, ""):
            c = canon_sector(v)
            if c != "—": return c
    return "—"

def build_establishments():
    print("Télécharge l’annuaire géolocalisé (exports GEOJSON)…")
    gj = export_geojson(DS_GEO)
    feats = gj.get("features", []) if isinstance(gj, dict) else []
    print(f"  -> {len(feats)} features")

    out, seen = [], set()
    skipped_closed = 0
    for ft in feats:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2): continue
        lon, lat = coords[0], coords[1]
        try: lat = float(lat); lon = float(lon)
        except Exception: continue

        uai = pick_ci(props, "numero_uai","uai","code_uai")
        if not uai: continue

        nat = pick_ci(props, "nature_uai_libe","libelles_nature","nature","nature_uai","libelle_nature")
        typ = nature_to_type(nat)
        if not typ: continue

        # n'affiche que les établissements en service (exclut "A OUVRIR"/"A FERMER").
        # Mettre KEEP_ONLY_OPEN = False pour retrouver l'ancien comportement.
        if KEEP_ONLY_OPEN:
            etat = pick_ci(props, "etat_etablissement_libe", "etat_etablissement")
            if etat not in (None, "") and str(etat).strip().upper() not in ("OUVERT", "1"):
                skipped_closed += 1
                continue

        secteur = sector_from_props(props)
        name = pick_ci(props, "appellation_officielle","nom_etablissement","nom_de_l_etablissement",
                       "denomination_principale","denomination_usuelle") or "Établissement"
        commune = pick_ci(props, "nom_de_la_commune","libelle_commune","commune","nom_commune","ville") or ""
        cp = pick_ci(props, "code_postal_uai","adresse_code_postal","code_postal","cp") or ""
        insee = pick_ci(props, "code_commune","code_commune_uai","code_insee_commune","code_commune_insee") or ""
        dep = pick_ci(props, "code_du_departement","code_departement","departement_code","code_dept") or derive_dep(cp,insee)

        row = {"uai":str(uai),"type":typ,"secteur":secteur,"lat":lat,"lon":lon,
               "dep":str(dep or "").upper(),"cp":str(cp or ""), "commune":commune,"name":name}
        key = (row["uai"], row["type"])
        if key in seen: continue
        seen.add(key); out.append(row)

    out.sort(key=lambda x: (x["dep"], x["type"], x["uai"]))
    with open("data/establishments.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    n_unknown = sum(1 for r in out if r["secteur"] == "—")
    print(f"OK: data/establishments.min.json ({len(out)} établissements"
          f" — {skipped_closed} non ouverts écartés, {n_unknown} sans secteur déclaré)")

# Champ IPS de l'établissement : les 3 jeux de données n'ont PAS le même schéma.
# Les lycées n'ont pas de colonne "ips" : c'est "ips_etab" (l'établissement complet),
# à ne pas confondre avec ips_voie_gt / ips_voie_pro (une seule voie) ni avec les
# ips_national_* / ips_academique_* / ips_departemental_* (moyennes de référence).
IPS_FIELDS = {
    "ecole":   ("ips", "indice_position_sociale", "indice"),
    "college": ("ips", "indice_position_sociale", "indice"),
    "lycee":   ("ips_etab", "ips_voie_gt", "ips_voie_pro", "ips_post_bac"),
}

def parse_rentree(y):
    """'2024-2025' -> 2024 ; '2024' -> 2024 ; 2024 -> 2024 ; sinon None."""
    if isinstance(y, int):
        return y
    m = re.match(r"\s*(\d{4})", str(y or ""))
    return int(m.group(1)) if m else None

def build_ips():
    print("Télécharge IPS (exports JSON, dernière rentrée par UAI)…")
    result = {}
    for tag, ds in DS_IPS.items():
        rows = export_json(ds)
        fields = IPS_FIELDS.get(tag, ("ips",))
        best = {}
        for r in rows:
            u_raw = pick_ci(r, "uai", "code_uai")
            if not u_raw:
                continue
            u = str(u_raw).strip().upper()

            # champs explicites uniquement : un "premier champ contenant ips"
            # attraperait ips_national_* et fausserait complètement le score.
            val = pick_ci(r, *fields)
            if val is None:
                continue
            try:
                v = float(val)
            except Exception:
                continue

            year = parse_rentree(pick_ci(r, "rentree_scolaire", "rentree", "annee"))
            prev = best.get(u)
            # l'export n'est pas trié par rentrée : on compare vraiment les années
            if prev is None or (year or -1) > (prev[0] or -1):
                best[u] = (year, v)

        years = sorted({y for y, _ in best.values() if y is not None})
        kept = max(years) if years else "?"
        print(f"  • {tag}: {len(best)} UAI — rentrées disponibles {years} — retenue {kept}")

        for u, (_y, v) in best.items():
            result[u] = v
        time.sleep(0.05)

    with open("data/ips.min.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: data/ips.min.json ({len(result)} UAI avec IPS)")

def _to_float(x):
    if x in (None, ""):
        return None
    try:
        return float(str(x).replace(",", ".").replace("%", "").strip())
    except (TypeError, ValueError):
        return None

def build_exams():
    """data/exams.min.json — taux de réussite + valeur ajoutée par établissement.

    Sortie : { "meta": {kind: {annee, prec, national, n, sessions}},
               "etab": {UAI: {kind: {t, tp, va, vaN, vaMin, vaMax, m, n}}} }

    t = taux de la dernière session, tp = session précédente, m = taux de
    mention (lycées), n = candidats/présents.

    va est la MOYENNE de la valeur ajoutée sur les dernières sessions, pas la
    dernière valeur : sur un collège de 60 candidats elle passe de +7 à -4 sans
    que rien n'ait changé dans l'établissement. vaMin/vaMax donnent l'amplitude
    — un écart large signale un indicateur à ne pas prendre au pied de la
    lettre, vaN le nombre de sessions retenues.

    Aucun équivalent n'existe pour le premier degré : les évaluations
    nationales ne sont pas publiées par école. Le fichier ne couvre donc
    que les collèges et les lycées.
    """
    print("Télécharge les résultats aux examens (brevet + bac)…")
    meta, etab = {}, {}

    for kind, conf in DS_EXAMS.items():
        rows = export_json(conf["dataset"])

        # regroupe par année : ces jeux contiennent plusieurs millésimes
        par_annee = {}
        for r in rows:
            y = parse_rentree(pick_ci(r, conf["annee"]))
            u = str(pick_ci(r, "uai", "code_uai") or "").strip().upper()
            t = _to_float(pick_ci(r, conf["taux"]))
            if y is None or not u or t is None:
                continue
            par_annee.setdefault(y, {})[u] = {
                "t":  round(t, 1),
                "va": _to_float(pick_ci(r, conf["va"])),
                "m":  _to_float(pick_ci(r, conf["mention"])) if conf["mention"] else None,
                "n":  _to_float(pick_ci(r, conf["n"])),
            }

        if not par_annee:
            print(f"  • {kind}: aucune donnée exploitable, ignoré")
            continue

        annees = sorted(par_annee)
        cur, prev = annees[-1], (annees[-2] if len(annees) > 1 else None)
        courant = par_annee[cur]
        precedent = par_annee.get(prev, {})

        # IVAC couvre 2022-2025, IVAL remonte à 2020 : on borne à 4 sessions
        # pour que les deux niveaux soient comparables et qu'on ne fasse pas
        # peser des millésimes trop anciens sur un établissement qui a changé.
        retenues = annees[-SESSIONS_VA:]
        va_par_uai = {}
        for y in retenues:
            for u, v in par_annee[y].items():
                if v["va"] is not None:
                    va_par_uai.setdefault(u, []).append(v["va"])

        # taux national = moyenne pondérée par le nombre de candidats
        num = sum(v["t"] * v["n"] for v in courant.values() if v["n"])
        den = sum(v["n"] for v in courant.values() if v["n"])
        national = round(num / den, 1) if den else None

        meta[kind] = {"annee": cur, "prec": prev, "national": national,
                      "n": len(courant), "sessions": retenues}

        for u, v in courant.items():
            row = {"t": v["t"]}
            tp = precedent.get(u, {}).get("t")
            if tp is not None:  row["tp"] = tp
            vals = va_par_uai.get(u)
            if vals:
                row["va"] = round(sum(vals) / len(vals), 1)
                row["vaN"] = len(vals)
                if len(vals) > 1:
                    row["vaMin"] = round(min(vals), 1)
                    row["vaMax"] = round(max(vals), 1)
            if v["m"] is not None:   row["m"] = round(v["m"], 1)
            if v["n"]:               row["n"] = int(v["n"])
            etab.setdefault(u, {})[kind] = row

        avec_va = sum(1 for u in courant if u in va_par_uai)
        plusieurs = sum(1 for u in courant if len(va_par_uai.get(u, [])) > 1)
        amplitudes = [max(v) - min(v) for u, v in va_par_uai.items() if len(v) > 1]
        moy_amp = round(sum(amplitudes) / len(amplitudes), 1) if amplitudes else 0
        print(f"  • {kind}: {len(courant)} établissements en {cur} "
              f"(précédent {prev}) — national {national}% — VA sur {avec_va}, "
              f"dont {plusieurs} moyennés sur {retenues[0]}-{retenues[-1]} "
              f"(amplitude moyenne {moy_amp} pts)")
        time.sleep(0.05)

    out = {"meta": meta, "etab": etab}
    with open("data/exams.min.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: data/exams.min.json ({len(etab)} établissements)")

def build_dep_bundles():
    """data/dep/<dep>.min.json — tout ce qui concerne un département.

    L'annuaire national pèse 2,4 Mo gzippés et était téléchargé avant même que
    la première recherche puisse aboutir. Découpé par département, une recherche
    ne tire que ce dont elle a besoin (18 Ko en médiane, 88 Ko pour le Nord).

    data/dep/index.json porte l'emprise géographique de chaque département :
    l'app y lit quels fichiers un cercle de recherche recoupe, ce qui règle le
    cas des rayons à cheval sur une frontière sans table d'adjacence à tenir.

    establishments/ips/exams.min.json restent produits comme intermédiaires de
    build mais ne sont plus livrés au navigateur.
    """
    print("Assemble les bundles par département…")
    est = json.load(open("data/establishments.min.json", encoding="utf-8"))
    ips = json.load(open("data/ips.min.json", encoding="utf-8"))
    exams = json.load(open("data/exams.min.json", encoding="utf-8"))
    ex_etab, ex_meta = exams.get("etab", {}), exams.get("meta", {})

    par_dep = {}
    for e in est:
        d = norm_dep(e.get("dep"))
        if not d:
            continue
        par_dep.setdefault(d, []).append(e)

    out_dir = os.path.join("data", "dep")
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".json"):
            os.remove(os.path.join(out_dir, f))

    # Grille de 0,1° (~11 km) : quelle(s) commune(s) départementale(s) occupent
    # chaque cellule. Une emprise rectangulaire par département ne tenait pas :
    # une seule coordonnée erronée dans l'annuaire — une école de Savoie
    # géolocalisée en Normandie — étirait la boîte sur la moitié du pays et
    # faisait télécharger le département à chaque recherche parisienne.
    grille = {}
    index, total = {}, 0
    for dep, etabs in sorted(par_dep.items()):
        # trié, pas un set : l'ordre d'itération d'un set de chaînes varie d'une
        # exécution à l'autre (PYTHONHASHSEED), ce qui réécrivait les 105 bundles
        # à chaque build et faisait commiter 12 Mo de bruit au workflow mensuel
        # alors qu'aucune donnée n'avait bougé.
        uais = sorted({e["uai"] for e in etabs})
        bundle = {
            "dep": dep,
            "etab": etabs,
            "ips": {u: ips[u] for u in uais if u in ips},
            "exams": {u: ex_etab[u] for u in uais if u in ex_etab},
        }
        path = os.path.join(out_dir, f"{dep}.min.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
        total += os.path.getsize(path)

        index[dep] = {"n": len(etabs)}
        for e in etabs:
            cle = f"{int(math.floor(e['lat'] * 10))}_{int(math.floor(e['lon'] * 10))}"
            grille.setdefault(cle, set()).add(dep)

    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({
            "deps": index,
            "grid": {k: sorted(v) for k, v in sorted(grille.items())},
            "examsMeta": ex_meta,
        }, f, ensure_ascii=False, separators=(",", ":"))

    gros = sorted(par_dep.items(), key=lambda kv: -len(kv[1]))[:3]
    print(f"OK: data/dep/ — {len(par_dep)} départements, {total // 1024} Ko au total "
          f"(plus gros : " + ", ".join(f"{d} ({len(v)} étab.)" for d, v in gros) + ")")

def write_version():
    """data/version.json — cache-buster daté, écrit à chaque build.

    Évite d'avoir à incrémenter DATA_VERSION à la main : le navigateur lit ce
    fichier sans cache puis suffixe toutes les URL de données avec sa valeur.
    C'est ce qui permet au workflow de rafraîchissement de publier sans
    intervention.
    """
    v = time.strftime("%Y%m%d-%H%M")
    with open("data/version.json", "w", encoding="utf-8") as f:
        json.dump({"v": v, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    print(f"OK: data/version.json ({v})")

DS_CARTE_SCOLAIRE = "fr-en-carte-scolaire-colleges-publics"

def norm_dep(d):
    """'001' -> '01', '054' -> '54', '973' -> '973', '2A' -> '2A'"""
    s = str(d or "").strip().upper()
    if not s:
        return ""
    # la Corse arrive en "02A"/"02B" dans l'annuaire, mais l'app cherche "2A"/"2B"
    if re.fullmatch(r"0?2[AB]", s):
        return s[-2:]
    if re.fullmatch(r"\d{3}", s) and s.startswith("0"):
        s = s[1:]
    if re.fullmatch(r"\d{1,2}", s):
        return s.zfill(2)
    return s

def norm_voie(s):
    """Clé de voie commune au build et au navigateur.

    Le jeu MENJ écrit déjà en majuscules sans accents et remplace les
    apostrophes par des espaces ("PASSAGE DE L ECOLE"). On applique le même
    traitement à ce que renvoie la BAN pour que les deux se rejoignent.
    """
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def build_secteurs():
    """data/secteur/<dep>.min.json — collège de secteur par adresse.

    Un fichier par département, chargé à la demande : les 520 000 lignes du
    jeu national ne peuvent pas partir dans le navigateur d'un coup.

    Deux cas dans la source :
      • secteur_unique = O  -> toute la commune dépend d'un seul collège
      • sinon               -> tronçons de voie (numéros début/fin + parité)

    Les UAI sont mutualisés dans un tableau et référencés par index : un
    département compte des dizaines de milliers de tronçons pour quelques
    dizaines de collèges.
    """
    print("Télécharge la carte scolaire des collèges publics…")
    url = f"{BASE_EXPLORE}{DS_CARTE_SCOLAIRE}/exports/csv?delimiter=%3B"
    raw = _fetch_bytes(url).decode("utf-8-sig", "replace")

    deps = {}
    lignes = 0
    for r in csv.DictReader(io.StringIO(raw), delimiter=";"):
        uai = (r.get("code_rne") or "").strip().upper()
        insee = (r.get("code_insee") or "").strip()
        if not uai or not insee:
            continue
        dep = norm_dep(r.get("code_departement"))
        if not dep:
            continue
        lignes += 1

        d = deps.setdefault(dep, {"dep": dep, "uai": [], "_idx": {}, "uniq": {}, "voies": {}})
        if uai not in d["_idx"]:
            d["_idx"][uai] = len(d["uai"])
            d["uai"].append(uai)
        iu = d["_idx"][uai]

        if (r.get("secteur_unique") or "").strip().upper() == "O":
            d["uniq"][insee] = iu
            continue

        voie = norm_voie(r.get("type_et_libelle"))
        if not voie:
            continue

        def num(x):
            x = (x or "").strip()
            try:
                return int(float(x))
            except (TypeError, ValueError):
                return None

        deb, fin = num(r.get("n_de_voie_debut")), num(r.get("n_de_voie_fin"))
        par = (r.get("parite") or "").strip().upper()
        if par not in ("P", "I"):
            par = "PI"          # y compris les ~30 lignes où le champ est corrompu

        d["voies"].setdefault(insee, {}).setdefault(voie, []).append([deb, fin, par, iu])

    out_dir = os.path.join("data", "secteur")
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".min.json"):
            os.remove(os.path.join(out_dir, f))

    total = 0
    index = {}
    for dep, d in sorted(deps.items()):
        d.pop("_idx", None)
        path = os.path.join(out_dir, f"{dep}.min.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        ko = os.path.getsize(path) // 1024
        total += os.path.getsize(path)
        index[dep] = {"communes": len(d["voies"]) + len(d["uniq"]), "ko": ko}

    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"deps": sorted(deps), "detail": index}, f, ensure_ascii=False, separators=(",", ":"))

    gros = sorted(index.items(), key=lambda kv: -kv[1]["ko"])[:3]
    print(f"OK: data/secteur/ — {len(deps)} départements, {lignes} tronçons, "
          f"{total // 1024} Ko au total (plus gros : "
          + ", ".join(f"{d} {v['ko']} Ko" for d, v in gros) + ")")

def build_gazetteer():
    print("Télécharge gazetteer communes…")
    arr = get_json(GEO_COMMUNES)
    out = []
    for c in arr:
        name = c.get("nom")
        centre = c.get("centre", {})
        cps = c.get("codesPostaux") or []
        coords = centre.get("coordinates") or [None,None]
        lon, lat = coords[0], coords[1]
        if name and isinstance(lon,(int,float)) and isinstance(lat,(int,float)):
            dep = ""
            if cps:
                cp0 = str(cps[0]); dep = cp0[:3] if cp0.startswith(("97","98")) else cp0[:2]
            out.append({"name":name,"cps":cps,"lat":lat,"lon":lon,"dep":dep})
    out.sort(key=lambda x: x["name"])
    with open("data/gazetteer.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    print(f"OK: data/gazetteer.min.json ({len(out)} communes)")

# ---------- IDFM: stations ----------
def _ascii_lower(x: str) -> str:
    return (str(x or "")
            .strip()
            .lower()
            .encode('utf-8', 'ignore')
            .decode('utf-8'))

def _first_non_empty_ci(d: dict | None, *keys, default=None):
    """Renvoie la première valeur non vide pour l'une des clés (recherche insensible à la casse)."""
    if not isinstance(d, dict):
        return default
    low = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(str(k).lower())
        if v not in (None, "", " "):
            return v
    return default

def _mode_token(mode_raw: str, reseau_raw: str | None = None, code_raw: str | None = None) -> str | None:
    s = _ascii_lower(mode_raw)
    r = _ascii_lower(reseau_raw)
    c = _ascii_lower(code_raw)
    txt = " ".join(v for v in [s, r, c] if v)

    # 👉 Ajout: détection explicite du TRAM
    if "tram" in txt or re.search(r"\bt\s*\d{1,2}[ab]?\b", txt):
        return "tram"

    if "rer" in txt:
        return "rer"
    if "metro" in txt or "métro" in txt or re.search(r"\bm\d+\b", txt):
        return "metro"
    if "transilien" in txt or ("sncf" in txt and "rer" not in txt):
        return "transilien"
    if re.search(r"\bter\b", txt):
        return "ter"
    if "tgv" in txt:
        return "tgv"
    if re.search(r"\brer\s*[a-e]\b", txt):
        return "rer"
    if re.search(r"\bm\s*\d{1,2}\b", txt):
        return "metro"
    return None

# --- Regex pour les lignes ---
_LINE_NUM_RE = re.compile(r"(?:\b(?:ligne|lin|l)\s*|^)\s*([0-9]{1,2})\b", re.I)
_LINE_M_RE   = re.compile(r"\bm\s*([0-9]{1,2})\b", re.I)
_LINE_RER_RE = re.compile(r"\brer\s*([A-E])\b", re.I)
_LINE_LETTER = re.compile(r"\b([HJLNPUKR])\b", re.I)      # Transilien
_LINE_TRAM   = re.compile(r"\bT\s*([0-9]{1,2}[a-b]?)\b", re.I)

def _parse_line_from_text(txt: str, mode: str | None) -> str | None:
    if not txt:
        return None
    t = str(txt)

    m = _LINE_RER_RE.search(t)
    if m: return m.group(1).upper()

    # Métro / nombre isolé
    m = _LINE_M_RE.search(t)
    if m and (mode == "metro" or not mode):
        return m.group(1)
    m = _LINE_NUM_RE.search(t)
    if m and (mode == "metro" or not mode):
        return m.group(1)

    m = _LINE_TRAM.search(t)
    if m:
        return f"T{m.group(1)}"

    m = _LINE_LETTER.search(t)
    if m and (mode == "transilien" or not mode):
        return m.group(1).upper()

    return None

def _extract_line(props: dict, mode: str | None, name_fallback: str | None = None) -> str | None:
    # 1) Champs directs typiques
    direct = _first_non_empty_ci(
        props,
        "route_short_name", "short_name", "shortname",
        "ligne", "line", "num_ligne", "num_lig", "code_ligne", "id_ligne",
        "idref_ligne", "code", "code_lig", "route", "route_id"
    )
    if isinstance(direct, (str, int)):
        val = str(direct).strip()
        # Ajustements par mode
        if mode == "metro":
            m = _parse_line_from_text(val, mode)
            if m: return m
            if re.fullmatch(r"\d{1,2}", val):
                return val
        if mode == "rer":
            m = re.fullmatch(r"[A-E]", val.upper())
            if m: return m.group(0)
        if mode == "transilien":
            m = re.fullmatch(r"[HJLNPUKR]", val.upper())
            if m: return m.group(0)
        if mode == "tram":
            m = _LINE_TRAM.search(val.upper())
            if m: return f"T{m.group(1)}"
        m = _parse_line_from_text(val, mode)
        if m: return m

    # 2) Nom de la gare (ex: "M8 Maisons-Alfort – Le Stade", "RER A La Défense")
    name_txt = _first_non_empty_ci(
        props,
        "name", "nom", "nom_gare", "nomlong", "nom_long",
        "nom_zdl", "libelle", "label", "stop_name", "station_name", "gare"
    ) or name_fallback
    if name_txt:
        m = _parse_line_from_text(str(name_txt), mode)
        if m: return m

    # 3) Blobs descriptifs (reseau contient souvent "RER A" / "M 8")
    blob = " ".join(str(_first_non_empty_ci(props, k, default="")) for k in [
        "reseau", "reseaufr", "network",
        "route_long_name", "route_desc", "desc", "commentaire"
    ])
    m = _parse_line_from_text(blob, mode)
    if m: return m

    return None

def _records_to_stations(data):
    out = []
    for rec in (data or {}).get("results", []):
        geom = rec.get("geometry") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2):
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            continue

        fields = rec.get("fields", {}) or {}

        # 🔧 Nom : on ratisse large (name/stop_name/station_name/nom/nom_gare/…)
        name = (
            _first_non_empty_ci(
                fields,
                "name", "stop_name", "station_name",
                "nom", "nom_gare", "nomlong", "nom_long", "nom_zdl",
                "libelle", "label", "nomcourt", "gare"
            )
            or _first_non_empty_ci(rec, "name", "nom", "libelle")
            or "Gare"
        )

        # Mode + ligne (robuste)
        raw_mode   = _first_non_empty_ci(fields, "mode", "mode_", "transport", "type")
        raw_reseau = _first_non_empty_ci(fields, "reseau", "reseaufr", "network")
        raw_code   = _first_non_empty_ci(fields, "route_short_name", "short_name", "shortname", "code", "ligne", "line")
        mode = _mode_token(str(raw_mode or ""), str(raw_reseau or ""), str(raw_code or ""))
        if not mode:
            mode = _mode_token("", "", str(_first_non_empty_ci(fields, "ligne", "commentaire") or ""))
        if not mode:
            continue

        line = _extract_line(fields or {}, mode, name)

        typ = "Station" if mode == "metro" else ("Station" if mode == "tram" else "Gare")
        out.append({"name": str(name), "type": typ, "mode": mode, "line": line, "lat": lat, "lon": lon})
    return out

def _export_to_stations(gj):
    feats = gj.get("features", []) if isinstance(gj, dict) else []
    out = []
    for ft in feats:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2):
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            continue

        # 🔧 Nom : idem records
        name = (
            _first_non_empty_ci(
                props,
                "name", "stop_name", "station_name",
                "nom", "nom_gare", "nomlong", "nom_long", "nom_zdl",
                "libelle", "label", "nomcourt", "gare"
            )
            or "Gare"
        )

        raw_mode   = _first_non_empty_ci(props, "mode", "mode_", "transport", "type")
        raw_reseau = _first_non_empty_ci(props, "reseau", "reseaufr", "network")
        raw_code   = _first_non_empty_ci(props, "route_short_name", "short_name", "shortname", "code", "ligne", "line")
        mode = _mode_token(str(raw_mode or ""), str(raw_reseau or ""), str(raw_code or ""))
        if not mode:
            mode = _mode_token("", "", str(_first_non_empty_ci(props, "ligne", "commentaire") or ""))
        if not mode:
            continue

        line = _extract_line(props or {}, mode, name)

        typ = "Station" if mode == "metro" else ("Station" if mode == "tram" else "Gare")
        out.append({"name": str(name), "type": typ, "mode": mode, "line": line, "lat": lat, "lon": lon})
    return out

def build_stations():
    print("Télécharge les gares/stations IDFM…")
    out = []

    # 0) Local file (si présent)
    if os.path.exists(LOCAL_STATIONS_SOURCE):
        try:
            gj = load_local_json(LOCAL_STATIONS_SOURCE)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via fichier local: {len(out)}")
        except Exception as e:
            print(f"  (local) échec: {e}")

    # 1) API records
    if not out:
        try:
            data = get_json(IDFM_RECORDS)
            out = _records_to_stations(data)
            if out:
                print(f"  -> via records: {len(out)}")
        except Exception as e:
            print(f"  (records) échec: {e}")

    # 2) Endpoint download (souvent plus permissif)
    if not out:
        try:
            gj = get_json(IDFM_DOWNLOAD)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via download: {len(out)}")
        except Exception as e:
            print(f"  (download) échec: {e}")

    # 3) Export geojson (dernier recours)
    if not out:
        try:
            gj = get_json(IDFM_EXPORT)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via export: {len(out)}")
        except Exception as e:
            print(f"  (export) échec: {e}")

    if not out:
        print("  !! Impossible de récupérer les gares/stations.")
        print("     -> Solution rapide : ouvre cette URL dans ton navigateur :")
        print("        ", IDFM_DOWNLOAD)
        print(f"        Enregistre le fichier comme {LOCAL_STATIONS_SOURCE} puis relance le build.")
        with open("data/stations.min.json","w",encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, separators=(",",":"))
        return

    # --- Post-traitement: formater le nom en PRÉFIXE (ex: 'RER A La Défense', 'Métro 8 ...') ---
    for r in out:
        base = str(r.get("name") or "").strip()
        mode = str(r.get("mode") or "").lower()
        line = str(r.get("line") or "").strip()

        prefix = ""
        if mode == "metro" and line:
            prefix = f"Métro {line}"
        elif mode == "rer" and line:
            prefix = f"RER {line}"
        elif mode == "tram" and line:
            prefix = f"Tram {line.replace('T','')}"
        elif mode == "transilien" and line:
            prefix = f"Transilien {line}"
        elif mode in ("ter", "tgv") and line:
            prefix = f"{mode.upper()} {line}"

        # Nom final + label cohérent
        if prefix:
            r["name"] = f"{prefix} {base}" if base else prefix
        else:
            r["name"] = base
        r["label"] = r["name"]

    out.sort(key=lambda r: (r.get("mode",""), r.get("name","")))
    with open("data/stations.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    # Evite un 304 si la rebuild tombe dans la même seconde
    os.utime("data/stations.min.json", None)
    print(f"OK: data/stations.min.json ({len(out)} gares/stations)")

# ---------------- main ----------------
if __name__ == "__main__":
    build_establishments()
    build_ips()
    build_exams()
    build_dep_bundles()
    build_secteurs()
    build_gazetteer()
    build_stations()
    write_version()
    print("Terminé.")
