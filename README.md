# Dorking Tool — Search Engine OSINT & Reconnaissance Workbench

A local-first, passive **search-engine reconnaissance workbench** for generating, organizing, prioritizing, explaining, and managing dork queries for targets you are **authorized** to assess.

It runs as a lightweight **HTML/CSS/JavaScript** application and can operate in **browser-only mode** (no backend) or with an optional **local Python server** (`server.py`) for APIs, file-based persistence, dork-pack/archive endpoints, and auto-detected query engines (Go/Java/Rust/C++ with Python fallback).

> **Authorized Use Only — Passive Reconnaissance**
>
> Use this tool only against domains/assets you own or have explicit written permission to test.
> - Generates search-engine queries/links and investigation helpers only.
> - **Does not** scan, crawl, probe, access, exploit systems, collect credentials/sensitive contents, or scrape/bypass search engines.
> - Results are **investigation leads, not confirmed findings**. Priorities/statuses are triage aids, not vulnerability severity.

**Repository description (suggested):** Local-first passive OSINT dorking/recon workbench (HTML/JS UI + optional Python server) for authorized targets — query generation, workbench, custom dorks, playbooks, archive tools, and multi-engine support.

## Screenshots

| Dashboard / Quick Start | Reconnaissance |
| --- | --- |
| ![Dashboard and Quick Start](screenshots/01-dashboard.jpg) | ![Reconnaissance view](screenshots/02-reconnaissance.jpg) |
| **Dashboard / Quick Start:** entry point for fast, simple usage. Enter an authorized target, choose a quick mode and engine, generate queries, and jump into advanced views (Reconnaissance, Playbooks, Workbench). Shows active project/target, query counts, priority/category distribution, and recent projects/history. | **Reconnaissance:** structured target setup with normalization/validation, scope selection (root, root + subdomains, exact host, custom), engine selection, module selection, and generation controls (simple defaults with advanced options available). |

| Playbooks | Query Workbench |
| --- | --- |
| ![Playbooks](screenshots/03-playbooks.jpg) | ![Query Workbench](screenshots/04-workbench.jpg) |
| **Playbooks:** predefined reconnaissance workflows (e.g. full domain, web app, infrastructure, sensitive-file indicators, API, bug-bounty intelligence) with customizable module coverage for consistent, repeatable passive recon. | **Query Workbench:** inspect and manage generated queries (search/filter/sort, details/explanation, operator/compatibility/scope info, status/notes/save, copy/open/export). Includes bulk actions and engine-aware links; priorities are investigation aids, not findings. |

| Custom Dorks | Archive / Tools |
| --- | --- |
| ![Custom Dorks](screenshots/05-custom-dorks.jpg) | ![Archive / Tools](screenshots/06-archive-tools.jpg) |
| **Custom Dorks 2.0:** create/edit/duplicate/delete custom query templates with labels, categories, priorities, tags, descriptions, placeholders (`{target}`, `{keyword}`), validation, auto-scoping, composer, bulk replace, JSON import/export, and built-in `.txt` dork-pack import. | **Archive / Tools:** passive helper utilities including Wayback CDX archive lookup (via local server endpoint when available), filtering/copy/export/open helpers, and URL categorization support using `ResultsStructure.json` rules. External lookups are handled gracefully. |

## Key features

- **Simple to start, advanced when needed**
  - Quick Start on Dashboard for fast target-to-results workflow
  - Reconnaissance view for scoped/module-based generation
  - Playbooks for common recon workflows
  - Collapsible/optional advanced controls to keep UX approachable
- **Query generation & reconnaissance engine**
  - Target normalization/validation (domains, subdomains, URLs, wildcard-style inputs), unsafe input rejection
  - Scope modes: root domain, root + subdomains, exact hostname, custom
  - Template-based generation with placeholders, normalization, dedupe, basic syntax validation
  - 10 modules / curated query sets covering domain intelligence, files/docs, login/admin, directories/indexing, config/secret indicators, backups/DB/log indicators, API/dev surfaces, security/disclosure intelligence, parameters/app behavior, and clearly separated global discovery
  - Priority indicators: Critical/High/Medium/Low/Informational (**not** vulnerability severity)
- **Workbench & workflow**
  - Explain queries (operators, compatibility notes, scope type)
  - Open/copy/copy-link/save, manual statuses and notes
  - Search, filter, sort, bulk select/copy/export/open (with safeguards)
  - Engine switching without regenerating query logic
- **Custom Dorks & packs**
  - Custom templates with validation/preview and auto-scoping (without breaking intentional global queries)
  - Visual composer, bulk find/replace, JSON import/export
  - Built-in/importable dork packs from `dorks/*.txt` with placeholder normalization
- **Projects, history, exports**
  - Multiple local projects/workspaces (target, scope, engine, modules, generated/saved/custom queries, notes, timestamps)
  - Project import/export/duplicate; session history reopen/search/export/clear
  - Export/report outputs (e.g. TXT/CSV/JSON/Markdown) with metadata and lead-not-finding disclaimer
- **Archive & passive tools**
  - Wayback CDX archive lookup (`/api/archive` in server mode; browser-only direct fetch may be limited by CORS)
  - URL categorization using `ResultsStructure.json`
  - Passive-safe integration only (no automated Google scraping/proxy-rotated result harvesting)

## Run / install

### Option A — 1-click launcher (recommended)
**Requirements:** Python 3.x (stdlib only)

```bash
python run.py
```

- Starts the local server and opens the UI in your default browser
- Uses `127.0.0.1:8765` by default; selects a free port if needed
- Stop with `Ctrl+C` in the launcher terminal
- Respects `DORKING_HOST` and `DORKING_PORT`

### Option B — Browser-only mode (no backend)
1. Open `index.html` in a modern browser (keep `index.html`, `styles.css`, `data.js`, `app.js` together)
2. State is stored in browser `localStorage`

Optional static serving:
```bash
python -m http.server 8765
# then open http://127.0.0.1:8765/
```

### Option C — Manual Python server + HTML UI
```bash
python server.py
# or on Windows: run_server.bat
# open http://127.0.0.1:8765/
```

Server mode provides:
- Local static UI hosting + JSON APIs: `/api/health`, `/api/state`, `/api/history`, `/api/generate`, `/api/clear`, `/api/archive`, `/api/dorkpacks`
- File-based persistence in `data_store/` (`state.json`, `settings.json`, `history.json`)
- Auto-detected query engines for `/api/generate` with Python fallback

### Option D — Optional native query engines
`server.py` auto-detects available engines (priority order: Go, Rust, C++, Java) and falls back to pure Python if none are usable. Engines read JSON from stdin and use `data.json`.

- **Go** (`go/`): `go build -o engine.exe .` (or `engine` on Unix)
- **Java** (`java/`): `javac Engine.java` (run with `java -cp java Engine`)
- **Rust** (`rust/`): `cargo build --release` (produces `rust/target/release/dorking-engine*`)
- **C++** (`cpp/`): `powershell -ExecutionPolicy Bypass -File cpp/build_windows.ps1` or `c++ -O2 -std=c++17 cpp/engine.cpp -o cpp/engine`

If no native engine is built/available, the app still works fully via Python fallback and/or browser-only mode.

## Architecture & components

- **UI:** `index.html`, `styles.css`, `app.js`, `data.js`
- **Launcher:** `run.py` (1-click), `run_server.bat` (Windows convenience)
- **Server:** `server.py` (Python stdlib HTTP server, local APIs, static hosting, persistence)
- **Shared/data:** `data.json`, `dorks/*.txt`, `ResultsStructure.json`
- **Engines (optional):** `go/` (`main.go`, `go.mod`), `java/` (`Engine.java`), `rust/` (`Cargo.toml`, `src/main.rs`), `cpp/` (`engine.cpp`, build script)

## Privacy, safety, and handling

- **Passive/local by design:** query/link generation and local management only; no automated target interaction/exploitation
- **Storage:** browser `localStorage` (browser-only mode) and/or local `data_store/` files (server mode)
- **No telemetry:** no built-in external analytics
- **Safe UI practices:** safe text rendering, `http/https` URL validation, `rel="noopener noreferrer"` for external opens, input/import validation and unsafe-scheme rejection
- **Interpretation:** indicators and query results are leads for authorized investigation, not proof of exposure/vulnerability

## Known limitations

- Search operator support and behavior vary by engine and change over time; results depend on indexing
- Popup blockers may limit bulk-open actions
- Root-domain inference is heuristic for some multi-part/public-suffix cases
- Wayback/archive lookups depend on external service availability/network conditions
- Native engines are optional and require local toolchains to build; Python/browser fallbacks are available

## Sources / inspiration

- Common search operator and dorking patterns/community cheat sheets
- Curated public dork collections (e.g. [Proviesec/google-dorks](https://github.com/Proviesec/google-dorks), adapted/simplified for passive, authorized recon)
- Passive-safe ideas/resources inspired in part by `Gui-Dorking` (integrated selectively: packs, categorization, archive lookup) while excluding automated search-result scraping

## Legal / ethical notice

Use responsibly and lawfully. Only perform reconnaissance on systems and data you own or are explicitly authorized to assess, in compliance with applicable laws, policies, and program rules.
