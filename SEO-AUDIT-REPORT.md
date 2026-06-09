# SEO Audit — exe-cutio.com
**Date :** 2026-05-10  
**Outil :** claude-seo v1.9.8  
**Pages crawlées :** 10 (homepage + blog index + 8 articles)  
**Business type détecté :** B2B Professional Services — Conseil stratégique (FR/BE)

---

## Score de santé SEO global : 64 / 100

| Catégorie | Poids | Score | Pondéré |
|---|---|---|---|
| Technical SEO | 22% | 72 | 15.8 |
| Content Quality | 23% | 63 | 14.5 |
| On-Page SEO | 20% | 80 | 16.0 |
| Schema / Structured Data | 10% | 58 | 5.8 |
| Performance (CWV) | 10% | 58 | 5.8 |
| AI Search Readiness (GEO) | 10% | 30 | 3.0 |
| Images | 5% | 55 | 2.75 |
| **TOTAL** | **100%** | — | **63.65 → 64/100** |

---

## Top 5 problèmes critiques

1. **Aucun `llms.txt`** — invisible pour ChatGPT, Perplexity, Gemini (audience cible de dirigeants PME qui cherchent via AI)
2. **Blog index rendu côté client (JS fetch)** — le HTML initial de `/insights/` ne contient pas les articles : risque d'indexation partielle
3. **Google Fonts + Calendly CSS bloquants** — chargement synchrone impacte le LCP sur toutes les pages
4. **Author schema = Organization, pas Person** — signal E-E-A-T faible pour Google sur tous les articles
5. **og:image des articles = URLs Pexels directes** — peuvent expirer ou être retirées, cassent les previews sociales

## Top 5 quick wins

1. Ajouter `llms.txt` à la racine (30 min, impact AI immédiat)
2. Ajouter `<link rel="preconnect">` pour fonts.googleapis.com / fonts.gstatic.com / assets.calendly.com
3. Ajouter un `Person` schema pour le founder avec `sameAs` LinkedIn
4. Ajouter une page `/a-propos/` (entity establishment E-E-A-T)
5. Ajouter FAQ schema sur les articles (rich snippets gratuits)

---

## Technical SEO — 72/100

### ✅ Acquis
- `robots.txt` : `Allow: /` + Sitemap référencé — aucune restriction de crawl
- `lang="fr"` sur tous les `<html>` — signal langue correct
- Canonical tag présent sur toutes les pages
- `<meta name="robots" content="index, follow">` sur toutes les pages
- Sitemap.xml auto-régénérée par GitHub Actions à chaque nouvel article (`generate-article.js:442`)
- HTTPS Netlify ✅
- `<meta charset="UTF-8">` ✅
- Viewport mobile ✅
- Site 100% statique (pas de framework JS lourd) — excellent pour TTFB

### ⚠️ Problèmes identifiés

#### [HIGH] Google Fonts synchrone — render-blocking
```html
<!-- Actuel — bloque le rendu -->
<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">
```
```html
<!-- Fix — préconnexion + chargement asynchrone -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=..." as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet"></noscript>
```
Impact : amélioration LCP estimée 300–600ms.

#### [HIGH] Calendly CSS synchrone — render-blocking
```html
<!-- Actuel -->
<link href="https://assets.calendly.com/assets/external/widget.css" rel="stylesheet">
```
```html
<!-- Fix -->
<link rel="preload" href="https://assets.calendly.com/assets/external/widget.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
```

#### [MEDIUM] Aucun favicon déclaré
Aucun `<link rel="icon">` dans le `<head>`. Impact : onglet navigateur vide, signaux de qualité SEO légèrement impactés.
```html
<!-- À ajouter dans <head> -->
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

#### [MEDIUM] Pas de `<link rel="preconnect">` pour les domaines tiers
Domaines tiers chargés sans preconnect : `fonts.googleapis.com`, `fonts.gstatic.com`, `assets.calendly.com`, `cdn-cookieyes.com`, `www.googletagmanager.com`.
```html
<!-- À ajouter en début de <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://www.googletagmanager.com">
```

#### [MEDIUM] Blog index : articles rendus uniquement via JavaScript
`/insights/index.html` charge les articles via `fetch('/data/articles.json')`. Le HTML brut renvoyé à Googlebot lors du premier crawl ne contient pas les titres/liens des articles. Googlebot exécute JS (crawl en deux passes), mais :
- Les autres crawlers (Bing, DuckDuckGo) peuvent manquer les articles
- Le premier crawl ne voit aucun lien interne vers les articles
- Délai d'indexation plus long

**Fix :** Générer une liste statique des 8 derniers articles en `<noscript>` ou pré-inclure les balises `<a>` dans le HTML.

#### [LOW] `lastmod` absent sur homepage et blog index dans sitemap.xml
Mineur — Googlebot utilise peu ce champ, mais bonne pratique.

---

## Content Quality — 63/100

### ✅ Acquis
- Articles ~1 100 mots — lisible, pas thin content
- Structure H1 → H2 → H3 respectée sur tous les articles
- Contenu pratique, data-backed ("73% des dirigeants...", "30-40% de CA supplémentaire")
- Narrative cohérente avec le positionnement (tête dans le guidon / prise de hauteur)
- 4 catégories éditoriales claires et stratégiques
- Fréquence publication : 4x/semaine — excellent signal de fraîcheur

### ⚠️ Problèmes identifiés

#### [HIGH] Aucun lien externe dans les articles
Tous les articles ne citent aucune source externe. Pour Google E-E-A-T, les liens sortants vers des sources autoritaires (INSEE, études HBR, Bpifrance, etc.) sont un signal de qualité.
**Fix :** Ajouter 1–2 liens vers des sources citées par article dans le prompt Claude Haiku (`generate-article.js`).

#### [HIGH] Auteur = Organization, pas Person
Dans le JSON-LD `Article`, `author` est `{"@type": "Organization", "name": "EXECUTIO"}`. Google préfère un `Person` avec nom, URL de profil LinkedIn/About.
```json
// À remplacer dans generate-article.js
"author": {
  "@type": "Person",
  "name": "Moad Lotf",
  "url": "https://exe-cutio.com/a-propos/",
  "sameAs": "https://www.linkedin.com/in/[votre-profil]"
}
```

#### [MEDIUM] Mot count trop court pour certains sujets (~1 100 mots)
Pour des requêtes B2B compétitives comme "conseil stratégique PME" ou "croissance PME France", le contenu ranking est souvent 2 000–3 000 mots. 
**Fix :** Augmenter `max_tokens` de 3000 à 5000 dans `generate-article.js` et ajuster le prompt pour viser 1 800–2 200 mots.

#### [MEDIUM] Aucune page About / Qui sommes-nous
Sans page About, Google ne peut pas établir l'entité "EXECUTIO" ni son auteur. E-E-A-T directement impacté.

#### [LOW] Pas de contenu "pilier" long-form
Tous les articles sont de même longueur (~1 100 mots). Une architecture hub-and-spoke avec 1 pilier par catégorie (5 000–8 000 mots) + articles satellites renforcerait l'autorité topique.

---

## On-Page SEO — 80/100

### ✅ Acquis
- Titles : présents, uniques, formatés `[Titre article] | EXECUTIO` ✅
- Meta descriptions : présentes sur toutes les pages ✅
- Open Graph complet (title, description, url, type, image, locale) ✅
- Twitter Card `summary_large_image` ✅
- `og:locale` = `fr_FR` ✅
- `article:published_time` et `article:section` sur les articles ✅
- Slugs d'URL descriptifs et en français (`/insights/deleguer-sans-perdre-controle-pme/`) ✅

### ⚠️ Problèmes identifiés

#### [MEDIUM] Title tag homepage — "EXECUTIO" en premier
```html
<!-- Actuel -->
<title>EXECUTIO — Conseil stratégique & opérationnel pour dirigeants</title>

<!-- Mieux pour SEO (mot-clé en premier) -->
<title>Conseil stratégique pour dirigeants de PME — EXECUTIO</title>
```

#### [MEDIUM] Pas de `article:author` sur les articles
```html
<!-- À ajouter dans <head> des articles -->
<meta property="article:author" content="EXECUTIO">
```

#### [MEDIUM] `og:image` blog index = même image que homepage
`/insights/` utilise `og-home.jpg` identique à la homepage. Préférer une image distincte pour le blog.

#### [LOW] Meta description homepage (157 chars) — légèrement longue
Limite recommandée : 155 chars. Actuellement : "Vous avez la tête dans le guidon. Executio prend le recul à votre place — pour voir ce qui freine, ce qui mérite d'être scalé, et tracer le bon cap." = 151 chars. OK en réalité.

---

## Schema / Structured Data — 58/100

### ✅ Acquis
- `ProfessionalService` sur homepage ✅
- `Blog` sur `/insights/` ✅
- `Article` + `BreadcrumbList` sur tous les articles ✅

### ⚠️ Problèmes identifiés

#### [HIGH] ProfessionalService incomplet
```json
// Champs manquants à ajouter dans index.html
{
  "@type": "ProfessionalService",
  "name": "EXECUTIO",
  "@id": "https://exe-cutio.com/#organization",
  "email": "contact@exe-cutio.com",
  "founder": {
    "@type": "Person",
    "name": "Moad Lotf"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "email": "contact@exe-cutio.com",
    "availableLanguage": "French"
  },
  "sameAs": [
    "https://www.linkedin.com/company/executio",
    "https://www.facebook.com/executio",
    "https://www.instagram.com/executio_fin"
  ]
}
```

#### [HIGH] Article schema — `image` manquant
Le champ `image` est absent du JSON-LD `Article` alors que l'image Pexels est disponible. Sans `image`, l'article n'est pas éligible aux `Article` rich results de Google.
```json
// À ajouter dans generate-article.js lors de la génération
"image": {
  "@type": "ImageObject",
  "url": "[URL image Pexels]",
  "width": 940,
  "height": 650
}
```

#### [MEDIUM] Pas de FAQ schema
Les articles terminent souvent par "Une question sur votre situation ?" — opportunité de FAQ schema non exploitée. Les FAQ rich snippets occupent 2× plus d'espace en SERP.

#### [LOW] `logo` dans ProfessionalService pointe vers og-home.jpg
Le champ `logo` devrait pointer vers un fichier logo dédié (PNG, fond transparent, carré idéalement).

---

## Performance / Core Web Vitals — 58/100

*Note : PageSpeed API non disponible lors de l'audit. Estimations basées sur l'analyse du code source.*

### ✅ Points positifs
- HTML 100% statique, pas de SSR ni de JS framework — TTFB excellent attendu (<200ms sur Netlify CDN)
- CSS inline dans `<style>` en `<head>` — pas de fichier CSS externe bloquant pour les styles principaux
- `async` sur le tag Google Analytics ✅
- Animations CSS pures (pas de JS pour les animations visuelles) ✅
- GPU-accelerated cursor avec `transform: translate3d` + RAF ✅

### ⚠️ Problèmes identifiés

#### [HIGH] Ressources render-blocking identifiées
| Ressource | Type | Impact |
|---|---|---|
| `fonts.googleapis.com/css2?family=...` | CSS sync | ~200–400ms LCP |
| `assets.calendly.com/widget.css` | CSS sync | ~100–200ms LCP |
| `cdn-cookieyes.com/script.js` | JS (non-async) | ~100–300ms bloquant |

#### [MEDIUM] Images sans dimensions explicites
Les `<img>` dans les articles n'ont pas de `width` et `height` définis — risque de CLS (Cumulative Layout Shift) lors du chargement.

#### [MEDIUM] Pas de format WebP/AVIF pour les images
Les images Pexels sont en JPEG. Les images hébergées pourraient être converties. Netlify ne transforme pas les images automatiquement en plan Free.

---

## AI Search Readiness (GEO) — 30/100

C'est le **point faible majeur** du site. Le public cible d'Executio (dirigeants PME, 35–55 ans) cherche de plus en plus via ChatGPT, Perplexity et Gemini pour des questions du type "meilleur conseiller stratégique PME France" ou "comment déléguer sans perdre le contrôle PME".

### ✅ Acquis
- Contenu data-backed (statistiques, pourcentages) — bon signal de citabilité ✅
- Contenu pratique et actionnable ✅
- Structure H2/H3 claire — crawlable par LLMs ✅

### ⚠️ Problèmes identifiés

#### [CRITICAL] Pas de `llms.txt`
Fichier permettant aux LLMs (ChatGPT, Perplexity, Claude) de comprendre le site et d'utiliser son contenu.
**Fix :** Créer `/llms.txt` à la racine :
```
# EXECUTIO — Conseil stratégique pour dirigeants de PME

EXECUTIO est un cabinet de conseil stratégique externe pour dirigeants de PME et startups en croissance (France, Belgique).

## Mission
Apporter le recul stratégique que les dirigeants n'ont plus quand ils sont pris dans l'opérationnel.

## Contenu disponible
- /insights/ : articles de fond sur stratégie, croissance, organisation, prise de décision pour dirigeants

## Contact
contact@exe-cutio.com
```

#### [HIGH] Aucune page About/Qui sommes-nous
Les LLMs ne peuvent pas établir l'entité "EXECUTIO" ni son expertise sans page About. C'est aussi un pilier E-E-A-T.

#### [HIGH] Pas de FAQ schema
Les questions/réponses structurées sont les formats les plus cités par les LLMs. Les articles ont du potentiel mais aucune FAQ schema n'est générée.

#### [MEDIUM] Pas de `speakable` schema
Pour les assistants vocaux et AI summarizers, le schema `speakable` indique les sections à lire à haute voix.

#### [MEDIUM] Pas de liens retour (backlinks) visibles
Les LLMs privilégient les contenus cités par d'autres sources. Aucun signal de citation externe n'est détectable à ce stade.

---

## Images — 55/100

### ✅ Acquis
- Compression Pexels appliquée (`?auto=compress&cs=tinysrgb&h=650&w=940`) ✅
- Images contextuelles au sujet de l'article ✅

### ⚠️ Problèmes identifiés

#### [HIGH] og:image des articles = URLs Pexels directes
Les URLs Pexels peuvent changer ou expirer, cassant les aperçus sur LinkedIn, Facebook, Twitter lors du partage.
**Fix :** À la génération, télécharger et stocker l'image localement dans `/insights/[slug]/hero.jpg` et référencer cette URL locale dans og:image.

#### [MEDIUM] Pas de `alt` text sur les images hero des articles
Les balises `<img>` des articles doivent avoir un `alt` descriptif (pas vide) pour l'accessibilité et le SEO images.

#### [MEDIUM] Images sans `width` / `height`
CLS risk. Toujours définir les dimensions pour éviter le layout shift.

---

## Plan d'action prioritaire

### CRITIQUE — Faire immédiatement (< 48h)

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | Créer `/llms.txt` | 30 min | GEO : +++ |
| 2 | Ajouter `image` dans Article JSON-LD (generate-article.js) | 1h | Schema rich results |
| 3 | Ajouter `<link rel="preconnect">` fonts + Calendly + GTM | 20 min | LCP : +++ |
| 4 | Charger Google Fonts + Calendly CSS en `preload` async | 30 min | LCP : +++ |

### HIGH — Cette semaine

| # | Action | Effort | Impact |
|---|---|---|---|
| 5 | Créer page `/a-propos/` avec Person schema pour le founder | 2h | E-E-A-T : +++ |
| 6 | Modifier generate-article.js : auteur = Person (pas Organization) | 30 min | E-E-A-T : ++ |
| 7 | Modifier generate-article.js : ajouter 1-2 liens externes sourcés | 30 min | E-E-A-T : ++ |
| 8 | Télécharger images Pexels localement à la génération | 1h | og:image fiabilité |
| 9 | Compléter ProfessionalService schema (contactPoint, founder, sameAs) | 30 min | Schema : ++ |

### MEDIUM — Ce mois

| # | Action | Effort | Impact |
|---|---|---|---|
| 10 | Ajouter FAQ schema dans generate-article.js | 1h | Rich snippets |
| 11 | Précharger articles dans HTML statique (noscript fallback) | 2h | Indexation : ++ |
| 12 | Augmenter word count articles à 1 800–2 200 mots | 30 min prompt | Rankings : ++ |
| 13 | Ajouter favicon PNG + apple-touch-icon | 30 min | Qualité : + |
| 14 | Ajouter `alt` text aux images hero dans generate-article.js | 20 min | Images : + |
| 15 | Ajouter `width`/`height` sur les `<img>` | 30 min | CLS : + |

### LOW — Backlog

| # | Action | Effort | Impact |
|---|---|---|---|
| 16 | Page FAQ dédiée (`/faq/`) | 3h | E-E-A-T + GEO |
| 17 | Articles piliers longs (5 000+ mots) par catégorie | 1 jour | Autorité topique |
| 18 | `speakable` schema sur articles | 1h | Voice + AI |
| 19 | Page contact dédiée (pas juste email en footer) | 1h | Conversion + E-E-A-T |
| 20 | Page mentions légales / politique de confidentialité | 1h | RGPD + E-E-A-T |

---

## Résumé

exe-cutio.com a une **base SEO technique solide** (static, canonical, sitemap auto-générée, OG complet) mais souffre de **deux lacunes majeures** :

1. **E-E-A-T faible** : pas d'auteur Person, pas de page About, pas de liens externes — Google ne peut pas établir l'expertise et l'autorité d'Executio.
2. **GEO quasi-absent** : aucun `llms.txt`, aucun FAQ schema, aucune page About — le site est invisible pour les AI searchers (ChatGPT, Perplexity) alors que les dirigeants PME sont précisément le public qui utilise ces outils.

Le score passerait de **64 → 80+** en appliquant les 9 actions critiques et high en moins d'une semaine.
