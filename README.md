# Dorking Tool — Search Engine OSINT & Reconnaissance Workbench

A simple, local-first, **HTML-only** (browser-based) search-engine reconnaissance workbench for generating, organizing, prioritizing, explaining, and managing dork queries for targets you are **authorized** to assess.

> **Authorized Use Only — Passive Reconnaissance**
>
> Use this tool only against domains/assets you own or have explicit written permission to test.
> - Generates search-engine queries/links and investigation helpers only.
> - **Does not** scan, crawl, probe, access, exploit systems, collect credentials/sensitive contents, or scrape/bypass search engines.
> - Results are **investigation leads, not confirmed findings**. Priorities/statuses are triage aids, not vulnerability severity.

## Screenshots

| Dashboard / Quick Start | Reconnaissance |
| --- | --- |
| ![Dashboard and Quick Start](screenshots/01-dashboard.jpg) | ![Reconnaissance view](screenshots/02-reconnaissance.jpg) |
| **Dashboard / Quick Start:** enter an authorized target, choose a quick mode and engine, generate queries, and jump into advanced views. Shows project/target, counts, distributions, and recent activity. | **Reconnaissance:** target normalization/validation, scope selection, engine selection, module selection, and generation controls. |

| Playbooks | Query Workbench |
| --- | --- |
| ![Playbooks](screenshots/03-playbooks.jpg) | ![Query Workbench](screenshots/04-workbench.jpg) |
| **Playbooks:** predefined reconnaissance workflows with customizable module coverage. | **Query Workbench:** search/filter/sort, inspect/explain queries, statuses/notes/save, copy/open/export, and bulk actions. |

| Custom Dorks | Archive / Tools |
| --- | --- |
| ![Custom Dorks](screenshots/05-custom-dorks.jpg) | ![Archive / Tools](screenshots/06-archive-tools.jpg) |
| **Custom Dorks:** create/import/manage custom query templates, placeholders, bulk replace, JSON import/export, and dork-pack imports. | **Archive / Tools:** Wayback archive lookup (browser fetch; may be limited by CORS) and URL categorization using `ResultsStructure.json`. |

## Features

- **Quick Start, Reconnaissance, Playbooks** for fast and structured query generation
- **Target normalization/validation** and scope modes (root, root + subdomains, exact, custom)
- **Query Workbench** with explanations, filters/sorting, statuses/notes, save/copy/open/export
- **Custom Dorks** with templates, placeholders (`{target}`, `{keyword}`), import/export, bulk replace, and `.txt` pack import
- **Projects & History** stored locally in the browser (`localStorage`)
- **Cheatsheet & Settings** for operators/defaults/preferences
- **Passive-safe archive/categorization helpers** (Wayback lookup and URL categorization)

## Run (HTML-only)

1. Download/clone this folder.
2. Open `index.html` in a modern browser.

> Keep these files/folders together: `index.html`, `styles.css`, `app.js`, `data.js`, `ResultsStructure.json`, and `dorks/` (for built-in pack loading/import support).

### Notes
- Data is stored locally in your browser (`localStorage`).
- Some features that fetch local files (e.g. built-in dork packs / `ResultsStructure.json`) or external endpoints (Wayback) may be limited when opening `index.html` directly via `file://` due to browser restrictions (CORS/file access). If needed, use your browser’s local file access allowances or serve the folder with any simple static file server.
- Use a hard refresh (`Ctrl+F5`) after updating files.

## Project files

- `index.html` — app shell/UI structure
- `styles.css` — styling/theme
- `app.js` — application logic
- `data.js` — modules, query definitions, engines/playbooks/operators data
- `dorks/*.txt` — dork pack templates
- `ResultsStructure.json` — URL categorization rules
- `screenshots/` — README screenshots

## Legal / ethical notice

Use responsibly and lawfully. Only perform reconnaissance on systems and data you own or are explicitly authorized to assess.
