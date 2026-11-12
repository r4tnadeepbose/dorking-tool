# Dorking Tool — Search Engine OSINT & Reconnaissance Workbench

A simple, local-first **HTML-based** search-engine reconnaissance workbench for generating, organizing, prioritizing, explaining, and managing dork queries for targets you are **authorized** to assess.

It runs in the browser with the same UI/UX in two ways:
- **Browser-only:** open `index.html` directly
- **Local server (recommended):** run `run.py` or `server.py` to serve the UI locally (improves reliability for archive lookups and built-in pack loading)

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
| **Custom Dorks:** create/import/manage custom query templates, placeholders, bulk replace, JSON import/export, and dork-pack imports. | **Archive / Tools:** Wayback archive lookup and URL categorization using `ResultsStructure.json`. |

## Features

- **Quick Start, Reconnaissance, Playbooks** for fast and structured query generation
- **Target normalization/validation** and scope modes (root, root + subdomains, exact, custom)
- **Query Workbench** with explanations, filters/sorting, statuses/notes, save/copy/open/export
- **Custom Dorks** with templates, placeholders (`{target}`, `{keyword}`), import/export, bulk replace, and `.txt` pack import
- **Projects & History** stored locally in the browser (`localStorage`)
- **Cheatsheet & Settings** for operators/defaults/preferences
- **Passive-safe helpers** for archive lookup and URL categorization

## Run

### Option A — Local server (recommended)
**Requirements:** Python 3.x (stdlib only)

```bash
python run.py
```
- Starts `server.py` and opens the UI in your browser (`http://127.0.0.1:8765/` by default)
- Stop with `Ctrl+C`

Or run manually:
```bash
python server.py
```

### Option B — Browser-only
- Open `index.html` in a modern browser
- Keep these together: `index.html`, `styles.css`, `app.js`, `data.js`, `ResultsStructure.json`, `dorks/`

## Notes
- Data is stored locally in browser `localStorage`.
- When using the local server, archive lookups and built-in pack loading can work more reliably.
- After updates, use a hard refresh (`Ctrl+F5`).

## Project files

- `index.html`, `styles.css`, `app.js`, `data.js` — frontend UI/logic (same UI/UX)
- `server.py`, `run.py` — optional local server/launcher
- `dorks/*.txt`, `ResultsStructure.json` — packs and categorization rules
- `screenshots/` — README screenshots

## Legal / ethical notice

Use responsibly and lawfully. Only perform reconnaissance on systems and data you own or are explicitly authorized to assess.
