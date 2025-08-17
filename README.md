# IPS Map – Pack de fichiers

Deux variantes :

- **ips-map-standalone** : 1 seul fichier `app-standalone.html` (marche en double-clic, mais certains appels API peuvent être bloqués en `file://`. Préfère un mini-serveur ou GitHub Pages).
- **ips-map (modulaire)** : version propre pour hébergement (GitHub Pages, Netlify, Vercel). Ouvre `app.html`.

## Déploiement GitHub Pages (recommandé)
1. Crée un repo public `ips-map` sur GitHub et uploade les fichiers du dossier **ips-map** (pas la version standalone).
2. Settings → Pages → Deploy from a branch → `main` + `/ (root)` → Save.
3. Ouvre `https://<ton-user>.github.io/ips-map/app.html`.

## Serveur local rapide (Windows PowerShell)
```powershell
cd "C:\chemin\vers\ips-map"
python -m http.server 8000
```
Puis : http://localhost:8000/app.html
