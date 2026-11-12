(function () {
  'use strict';

  const ENGINES = [
    { id: 'google', label: 'Google', url: 'https://www.google.com/search?q={query}', notes: 'Broad operator support; some operators (e.g. cache:) may be limited or unavailable over time.' },
    { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q={query}', notes: 'Supports many core operators; behavior/coverage differs from Google.' },
    { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', notes: 'Privacy-focused; operator support differs and some advanced operators may be ignored.' }
  ];

  // Priority: critical, high, medium, low, informational
  // Each item: id, label, category, module, priority, template (query), description, explanation, operators, engines (compat notes), global (not target-scoped)
  const MODULES = [
    { id: 'domain', name: 'MODULE 01 — DOMAIN INTELLIGENCE', short: 'Domain Intelligence', categories: ['Domain Intelligence'] },
    { id: 'files', name: 'MODULE 02 — FILE & DOCUMENT DISCOVERY', short: 'Files & Documents', categories: ['Files & Documents'] },
    { id: 'login', name: 'MODULE 03 — LOGIN & ADMIN DISCOVERY', short: 'Login & Admin', categories: ['Login & Admin'] },
    { id: 'dirs', name: 'MODULE 04 — DIRECTORY & INDEXING', short: 'Directories & Indexing', categories: ['Directories & Indexing'] },
    { id: 'config', name: 'MODULE 05 — CONFIGURATION & SECRET EXPOSURE', short: 'Config & Secret Exposure', categories: ['Config & Secret Exposure'] },
    { id: 'backups', name: 'MODULE 06 — BACKUP, DATABASE & LOG DISCOVERY', short: 'Backups, DB & Logs', categories: ['Backups, DB & Logs'] },
    { id: 'api', name: 'MODULE 07 — API & DEVELOPMENT SURFACES', short: 'API & Dev Surfaces', categories: ['API & Development'] },
    { id: 'disclosure', name: 'MODULE 08 — SECURITY & DISCLOSURE INTELLIGENCE', short: 'Security & Disclosure', categories: ['Security & Disclosure'] },
    { id: 'params', name: 'MODULE 09 — PARAMETERS & APPLICATION BEHAVIOUR', short: 'Parameters & App Behavior', categories: ['Parameters & App Behavior'] },
    { id: 'globalbb', name: 'MODULE 10 — GLOBAL BUG BOUNTY DISCOVERY', short: 'Global Bug Bounty Discovery', categories: ['Global Bug Bounty Discovery'] }
  ];

  function q(id, label, category, module, priority, template, description, explanation, operators, enginesNote, global) {
    return { id, label, category, module, priority, template, description, explanation, operators: operators || [], enginesNote: enginesNote || 'Core operators; behavior may vary by engine.', global: !!global };
  }

  const QUERIES = [
    // MODULE 01
    q('dom-idx', 'All indexed pages', 'Domain Intelligence', 'domain', 'informational', 'site:{target}', 'Find pages indexed for the target scope.', 'Uses site: to scope results to the target domain/host.', ['site:'], 'Supported broadly; subdomain scoping differs by engine.'),
    q('dom-sub', 'Subdomain references', 'Domain Intelligence', 'domain', 'medium', 'site:*.{target} -www', 'Discover indexed subdomains related to the target.', 'site: with wildcard and exclusion of common www host to surface other subdomains.', ['site:', '-', '*'], 'Wildcard/subdomain behavior varies by engine.'),
    q('dom-hosts', 'Related hostnames in text', 'Domain Intelligence', 'domain', 'informational', '"{target}" -site:{target}', 'Mentions of the target outside its own indexed pages.', 'Searches for the target string while excluding on-site results.', ['""', 'site:', '-']),
    q('dom-code', 'Public code mentions', 'Domain Intelligence', 'domain', 'medium', '"{target}" (site:github.com OR site:gitlab.com OR site:bitbucket.org)', 'Public code hosting references to the target.', 'Looks for target mentions on common code platforms.', ['""', 'site:', 'OR', '()']),
    q('dom-paste', 'Public paste mentions', 'Domain Intelligence', 'domain', 'medium', '"{target}" (site:pastebin.com OR site:pastetext.net OR site:hastebin.com OR site:gist.github.com)', 'Public paste/sharing references.', 'Searches paste-style sites for target mentions.', ['""', 'site:', 'OR', '()']),
    q('dom-cache', 'Cached page (Google)', 'Domain Intelligence', 'domain', 'low', 'cache:{target}', 'Attempt to view a cached copy (engine-dependent).', 'Uses cache: operator where supported.', ['cache:'], 'Google-specific; may be limited/unavailable.'),
    q('dom-way', 'Historical/indexed date hints', 'Domain Intelligence', 'domain', 'low', 'site:{target} (inurl:2023 OR inurl:2024 OR inurl:2025)', 'Find URLs containing year patterns that may hint at older content.', 'Searches for year-like path segments within the target.', ['site:', 'inurl:', 'OR', '()'], 'Heuristic; not a true archive search.'),

    // MODULE 02
    q('file-pdf', 'PDF documents', 'Files & Documents', 'files', 'medium', 'site:{target} filetype:pdf', 'Indexed PDF documents.', 'Scopes to target and filters by PDF extension.', ['site:', 'filetype:']),
    q('file-office', 'Office documents', 'Files & Documents', 'files', 'medium', 'site:{target} (filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx OR filetype:ppt OR filetype:pptx OR filetype:csv)', 'Common office and spreadsheet files.', 'Combines multiple filetype filters.', ['site:', 'filetype:', 'OR', '()']),
    q('file-text', 'Text and data files', 'Files & Documents', 'files', 'medium', 'site:{target} (filetype:txt OR filetype:xml OR filetype:json OR filetype:md)', 'Plain text and structured data files.', 'Targets readable/data file extensions.', ['site:', 'filetype:', 'OR', '()']),
    q('file-present', 'Presentations', 'Files & Documents', 'files', 'low', 'site:{target} (filetype:ppt OR filetype:pptx OR filetype:key)', 'Presentation documents.', 'Filters for presentation formats.', ['site:', 'filetype:', 'OR', '()']),
    q('file-sensitive-kw', 'Documents with sensitivity keywords', 'Files & Documents', 'files', 'high', 'site:{target} filetype:pdf ("confidential" OR "internal use" OR "not for distribution" OR "proprietary")', 'PDFs containing common sensitivity markings.', 'Combines filetype filter with exact phrases.', ['site:', 'filetype:', '""', 'OR', '()']),
    q('file-business', 'Public business documents', 'Files & Documents', 'files', 'informational', 'site:{target} (filetype:pdf OR filetype:docx) ("policy" OR "manual" OR "report" OR "procedure")', 'Indexed policy/manual/report-style documents.', 'Searches business-document keywords in common formats.', ['site:', 'filetype:', '""', 'OR', '()']),

    // MODULE 03
    q('auth-login', 'Login pages', 'Login & Admin', 'login', 'high', 'site:{target} (inurl:login OR inurl:signin OR inurl:sign-in OR intitle:"login" OR intitle:"sign in")', 'Authentication entry points.', 'Matches login-related terms in URLs and titles.', ['site:', 'inurl:', 'intitle:', '""', 'OR', '()']),
    q('auth-admin', 'Admin interfaces', 'Login & Admin', 'login', 'high', 'site:{target} (inurl:admin OR inurl:administrator OR intitle:"admin" OR inurl:manage)', 'Administrative interfaces.', 'Looks for admin-related paths/titles.', ['site:', 'inurl:', 'intitle:', '""', 'OR', '()']),
    q('auth-sso', 'SSO/SAML/OAuth endpoints', 'Login & Admin', 'login', 'high', 'site:{target} (inurl:sso OR inurl:saml OR inurl:oauth OR inurl:auth OR inurl:openid)', 'Federated authentication endpoints.', 'Searches for common auth protocol path terms.', ['site:', 'inurl:', 'OR', '()']),
    q('auth-reset', 'Password reset flows', 'Login & Admin', 'login', 'medium', 'site:{target} (inurl:forgot OR inurl:reset OR inurl:recover OR "forgot password")', 'Account recovery pages.', 'Targets reset/recovery indicators.', ['site:', 'inurl:', '""', 'OR', '()']),
    q('auth-portal', 'Dashboards and portals', 'Login & Admin', 'login', 'medium', 'site:{target} (inurl:dashboard OR inurl:portal OR inurl:console OR inurl:account)', 'User/admin portals and consoles.', 'Looks for common portal path names.', ['site:', 'inurl:', 'OR', '()']),

    // MODULE 04
    q('dir-index', 'Directory listings', 'Directories & Indexing', 'dirs', 'high', 'site:{target} intitle:"index of"', 'Open directory listing pages.', 'Finds pages titled "index of".', ['site:', 'intitle:', '""']),
    q('dir-parent', 'Parent directory listings', 'Directories & Indexing', 'dirs', 'high', 'site:{target} intitle:"index of" "parent directory"', 'Directory listings with parent directory text.', 'Narrows index listings using body phrase.', ['site:', 'intitle:', '""']),
    q('dir-common', 'Common indexed folders', 'Directories & Indexing', 'dirs', 'medium', 'site:{target} intitle:"index of" ("/backup" OR "/uploads" OR "/files" OR "/private" OR "/admin")', 'Listings in commonly sensitive folder names.', 'Combines index listings with path keywords.', ['site:', 'intitle:', '""', 'OR', '()']),
    q('dir-static', 'Public static resources', 'Directories & Indexing', 'dirs', 'informational', 'site:{target} (inurl:/static/ OR inurl:/assets/ OR inurl:/public/)', 'Public static/asset paths.', 'Searches for common static resource directories.', ['site:', 'inurl:', 'OR', '()']),

    // MODULE 05
    q('cfg-env', 'Environment file references', 'Config & Secret Exposure', 'config', 'critical', 'site:{target} (inurl:.env OR ext:env OR ".env")', 'Potentially exposed environment file references.', 'Looks for .env in URLs/extensions/text. Indicator only; do not retrieve contents.', ['site:', 'inurl:', 'ext:', '""', 'OR', '()']),
    q('cfg-config', 'Configuration files', 'Config & Secret Exposure', 'config', 'high', 'site:{target} (ext:conf OR ext:cfg OR ext:ini OR ext:yaml OR ext:yml OR ext:toml OR ext:xml)', 'Indexed configuration-like files.', 'Filters by common config extensions.', ['site:', 'ext:', 'OR', '()']),
    q('cfg-git', 'Git metadata references', 'Config & Secret Exposure', 'config', 'critical', 'site:{target} (inurl:/.git OR ".git/config" OR intitle:"index of" ".git")', 'Indicators of exposed git metadata.', 'Searches for .git paths and config references. Indicator only.', ['site:', 'inurl:', 'intitle:', '""', 'OR', '()']),
    q('cfg-keys', 'Key/certificate filenames', 'Config & Secret Exposure', 'config', 'critical', 'site:{target} (ext:pem OR ext:key OR ext:ppk OR "id_rsa" OR "id_ed25519")', 'Potentially exposed key material filenames.', 'Looks for common private key filename patterns. Indicator only.', ['site:', 'ext:', '""', 'OR', '()']),
    q('cfg-cloud', 'Cloud config references', 'Config & Secret Exposure', 'config', 'high', 'site:{target} ("aws_access_key_id" OR "s3.amazonaws.com" OR "azure" OR "gcloud" OR "firebase")', 'Public references to cloud-related config indicators.', 'Keyword-based indicator search. Do not collect or validate credentials.', ['site:', '""', 'OR', '()']),
    q('cfg-backup', 'Config backups', 'Config & Secret Exposure', 'config', 'high', 'site:{target} (inurl:config ext:bak OR inurl:config ext:old OR inurl:config ext:backup)', 'Backup copies of configuration files.', 'Combines config path hints with backup extensions.', ['site:', 'inurl:', 'ext:', 'OR', '()']),

    // MODULE 06
    q('bak-archives', 'Backup/archive files', 'Backups, DB & Logs', 'backups', 'high', 'site:{target} (ext:bak OR ext:old OR ext:backup OR ext:zip OR ext:tar OR ext:gz OR ext:7z)', 'Backup and archive files.', 'Filters for common backup/archive extensions.', ['site:', 'ext:', 'OR', '()']),
    q('bak-db', 'Database dump references', 'Backups, DB & Logs', 'backups', 'critical', 'site:{target} (ext:sql OR ext:db OR ext:sqlite OR inurl:dump.sql OR inurl:database.sql)', 'Potential database dump files.', 'Looks for DB dump extensions and common names. Indicator only.', ['site:', 'ext:', 'inurl:', 'OR', '()']),
    q('bak-logs', 'Log files', 'Backups, DB & Logs', 'backups', 'high', 'site:{target} (ext:log OR inurl:log OR inurl:logs OR inurl:error.log)', 'Log file references.', 'Searches for log extensions/paths.', ['site:', 'ext:', 'inurl:', 'OR', '()']),
    q('bak-debug', 'Debug/error traces', 'Backups, DB & Logs', 'backups', 'medium', 'site:{target} ("stack trace" OR "traceback" OR "fatal error" OR "exception" OR "debug")', 'Publicly indexed error/debug text.', 'Finds common error/debug phrases.', ['site:', '""', 'OR', '()']),
    q('bak-temp', 'Temporary/indexed temp files', 'Backups, DB & Logs', 'backups', 'medium', 'site:{target} (ext:tmp OR ext:temp OR ext:swp OR inurl:tmp)', 'Temporary file indicators.', 'Searches for temp file extensions/paths.', ['site:', 'ext:', 'inurl:', 'OR', '()']),

    // MODULE 07
    q('api-rest', 'API path references', 'API & Development', 'api', 'medium', 'site:{target} (inurl:/api/ OR inurl:/v1/ OR inurl:/v2/ OR inurl:/graphql)', 'Common API path patterns.', 'Targets frequent API route segments.', ['site:', 'inurl:', 'OR', '()']),
    q('api-docs', 'Swagger/OpenAPI docs', 'API & Development', 'api', 'high', 'site:{target} (inurl:swagger OR inurl:swagger-ui OR inurl:openapi.json OR inurl:api-docs OR intitle:"Swagger UI")', 'API documentation endpoints.', 'Searches for Swagger/OpenAPI indicators.', ['site:', 'inurl:', 'intitle:', '""', 'OR', '()']),
    q('api-graphql', 'GraphQL surfaces', 'API & Development', 'api', 'high', 'site:{target} (inurl:graphql OR inurl:graphiql OR inurl:playground)', 'GraphQL endpoints and IDEs.', 'Looks for GraphQL-related paths.', ['site:', 'inurl:', 'OR', '()']),
    q('api-dev', 'Dev/staging/test environments', 'API & Development', 'api', 'high', 'site:{target} (inurl:dev OR inurl:staging OR inurl:test OR inurl:uat OR inurl:sandbox)', 'Non-production environment references on target.', 'Searches for environment keywords in URLs.', ['site:', 'inurl:', 'OR', '()']),
    q('api-devhosts', 'Dev/staging hostnames', 'API & Development', 'api', 'high', '(site:dev.{target} OR site:staging.{target} OR site:test.{target} OR site:uat.{target} OR site:sandbox.{target})', 'Common non-production hostnames.', 'Targets typical environment subdomains.', ['site:', 'OR', '()']),
    q('api-common', 'Common app endpoints', 'API & Development', 'api', 'medium', 'site:{target} (inurl:wp-content OR inurl:wp-admin OR inurl:phpinfo OR inurl:server-status)', 'Common framework/admin/debug paths.', 'Searches for well-known application paths.', ['site:', 'inurl:', 'OR', '()']),

    // MODULE 08
    q('sec-txt', 'security.txt (well-known)', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} inurl:/.well-known/security.txt', 'Standard security.txt location.', 'Targets well-known security.txt path.', ['site:', 'inurl:']),
    q('sec-txt-any', 'security.txt (any path)', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} inurl:security.txt', 'security.txt in non-standard locations.', 'Searches for security.txt in URLs.', ['site:', 'inurl:']),
    q('sec-policy', 'Security/disclosure policies', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} (inurl:security OR inurl:security-policy OR "vulnerability disclosure" OR "responsible disclosure")', 'Security and vulnerability disclosure pages.', 'Combines URL and phrase indicators.', ['site:', 'inurl:', '""', 'OR', '()']),
    q('sec-bounty', 'Bug bounty/report pages', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} ("bug bounty" OR "report a vulnerability" OR "vulnerability report" OR inurl:bug-bounty)', 'Bug bounty and reporting pages.', 'Looks for bounty/reporting terms.', ['site:', 'inurl:', '""', 'OR', '()']),
    q('sec-contact', 'Security contact indicators', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} ("security@" OR "psirt" OR "security contact")', 'Public security contact references.', 'Keyword search for contact indicators.', ['site:', '""', 'OR', '()']),
    q('sec-hof', 'Hall of fame / acknowledgements', 'Security & Disclosure', 'disclosure', 'informational', 'site:{target} ("hall of fame" OR "acknowledgements" OR "security researchers")', 'Researcher acknowledgement pages.', 'Searches for recognition-related phrases.', ['site:', '""', 'OR', '()']),

    // MODULE 09
    q('param-any', 'URLs with parameters', 'Parameters & App Behavior', 'params', 'medium', 'site:{target} inurl:?', 'Pages with query string parameters.', 'Finds URLs containing a query separator.', ['site:', 'inurl:']),
    q('param-redirect', 'Redirect-related parameters', 'Parameters & App Behavior', 'params', 'high', 'site:{target} (inurl:return= OR inurl:returnUrl= OR inurl:redirect= OR inurl:url= OR inurl:next= OR inurl:continue=)', 'Parameters often used in redirect flows (recon only).', 'Searches for common redirect parameter names. No testing/exploitation.', ['site:', 'inurl:', 'OR', '()']),
    q('param-common', 'Common parameter names', 'Parameters & App Behavior', 'params', 'medium', 'site:{target} (inurl:id= OR inurl:page= OR inurl:file= OR inurl:cat= OR inurl:doc=)', 'URLs with frequent parameter names (recon only).', 'Identifies parameterized endpoints by name patterns.', ['site:', 'inurl:', 'OR', '()']),
    q('param-search', 'Search/query inputs', 'Parameters & App Behavior', 'params', 'low', 'site:{target} (inurl:q= OR inurl:search= OR inurl:s= OR inurl:query= OR inurl:keyword=)', 'Endpoints accepting search terms.', 'Finds common search parameter names.', ['site:', 'inurl:', 'OR', '()']),

    // MODULE 10 - global discovery (no site:{target})
    q('g-bounty-url', 'Bug bounty in URL', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'inurl:"bug bounty" OR inurl:bugbounty', 'Pages with bug bounty in URL.', 'Global discovery query (not target-scoped).', ['inurl:', '""', 'OR'], 'Global discovery.', true),
    q('g-resp', 'Responsible disclosure pages', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'inurl:"responsible-disclosure" OR inurl:"vulnerability-disclosure-policy" OR "responsible disclosure"', 'Public responsible/vulnerability disclosure pages.', 'Global discovery query.', ['inurl:', '""', 'OR'], 'Global discovery.', true),
    q('g-sectxt', 'security.txt files', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'inurl:/.well-known/security.txt OR inurl:security.txt', 'Publicly indexed security.txt files.', 'Global discovery query.', ['inurl:', 'OR'], 'Global discovery.', true),
    q('g-report', 'Vulnerability reporting pages', 'Global Bug Bounty Discovery', 'globalbb', 'informational', '"submit vulnerability report" OR "report a vulnerability" OR "vulnerability reporting policy"', 'Pages inviting vulnerability reports.', 'Global discovery query.', ['""', 'OR'], 'Global discovery.', true),
    q('g-platform', 'Platform-hosted program references', 'Global Bug Bounty Discovery', 'globalbb', 'informational', '"powered by bugcrowd" -site:bugcrowd.com OR "powered by hackerone" -site:hackerone.com', 'Programs referencing common platforms (external pages).', 'Global discovery; excludes platform domains.', ['""', 'site:', '-', 'OR'], 'Global discovery.', true),
    q('g-gov', 'Government disclosure pages', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'site:*.gov.* ("responsible disclosure" OR "vulnerability disclosure")', 'Government-hosted disclosure references.', 'Global discovery scoped to gov TLD patterns.', ['site:', '""', 'OR', '()'], 'Global discovery; wildcard TLD behavior varies.', true),
    q('g-edu', 'Education disclosure pages', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'site:*.edu ("responsible disclosure" OR "security report vulnerability")', 'Education-hosted disclosure/security reporting.', 'Global discovery scoped to edu domains.', ['site:', '""', 'OR', '()'], 'Global discovery.', true),
    q('g-reward', 'Reward/acknowledgement mentions', 'Global Bug Bounty Discovery', 'globalbb', 'informational', '"responsible disclosure" ("reward" OR "bounty" OR "swag" OR "hall of fame")', 'Disclosure programs mentioning rewards or recognition.', 'Global discovery query.', ['""', 'OR', '()'], 'Global discovery.', true),
    q('g-regional', 'Regional disclosure discovery', 'Global Bug Bounty Discovery', 'globalbb', 'informational', '(site:*.eu OR site:*.nl OR site:*.uk OR site:*.de) "responsible disclosure"', 'Regional/domain-pattern discovery.', 'Global discovery using regional TLD patterns.', ['site:', '""', 'OR', '()'], 'Global discovery.', true),
    q('g-contact', 'Security contact in security.txt', 'Global Bug Bounty Discovery', 'globalbb', 'informational', 'inurl:/security.txt "Contact:"', 'security.txt files containing contact fields.', 'Global discovery query.', ['inurl:', '""'], 'Global discovery.', true)
  ];

  const PLAYBOOKS = [
    {
      id: 'pb-full', name: 'Full Domain Recon', description: 'Comprehensive target-scoped discovery across all relevant categories.',
      modules: ['domain','files','login','dirs','config','backups','api','disclosure','params'],
      includeGlobal: false,
      coverage: 'Indexed footprint, documents, auth/admin surfaces, directories, config/secret indicators, backups/logs/DB refs, APIs/dev surfaces, disclosure pages, and parameterized URLs.'
    },
    {
      id: 'pb-web', name: 'Web Application Recon', description: 'Application-focused reconnaissance for login, admin, APIs, and parameter surfaces.',
      modules: ['login','api','params','dirs'],
      includeGlobal: false,
      coverage: 'Authentication/admin portals, API and docs, parameterized endpoints, and common indexed directories.'
    },
    {
      id: 'pb-infra', name: 'Infrastructure Recon', description: 'Footprint, hostnames, and environment discovery.',
      modules: ['domain','api'],
      includeGlobal: false,
      coverage: 'Domain footprint, subdomain/hostname references, dev/staging/test hosts and paths, and tech surfaces.'
    },
    {
      id: 'pb-sensitive', name: 'Sensitive File Exposure Review', description: 'Publicly indexed indicators of sensitive files and artifacts.',
      modules: ['files','config','backups'],
      includeGlobal: false,
      coverage: 'Documents, configuration and key-material indicators, backups, archives, logs, and database dump references (indicators only).'
    },
    {
      id: 'pb-api', name: 'API Recon', description: 'API endpoints, documentation, and development surfaces.',
      modules: ['api','params'],
      includeGlobal: false,
      coverage: 'REST/GraphQL paths, Swagger/OpenAPI docs, dev/staging references, and parameterized API-like URLs.'
    },
    {
      id: 'pb-bounty', name: 'Bug Bounty Intelligence', description: 'Target disclosure info plus global program discovery.',
      modules: ['disclosure','globalbb'],
      includeGlobal: true,
      coverage: 'Target security.txt/policies/contacts and global responsible disclosure & bug bounty discovery queries.'
    }
  ];

  const OPERATORS = [
    { op: 'site:', syntax: 'site:example.com', desc: 'Restrict results to a domain or host.', example: 'site:example.com login', compat: 'Google, Bing, DuckDuckGo (behavior varies)', group: 'Domain' },
    { op: 'inurl:', syntax: 'inurl:keyword', desc: 'Match a term in the URL.', example: 'site:example.com inurl:admin', compat: 'Google, Bing; limited/variable on DuckDuckGo', group: 'URL' },
    { op: 'allinurl:', syntax: 'allinurl:kw1 kw2', desc: 'Match multiple terms in the URL.', example: 'allinurl:admin login', compat: 'Google; limited elsewhere', group: 'URL' },
    { op: 'intitle:', syntax: 'intitle:"phrase"', desc: 'Match a term/phrase in the page title.', example: 'intitle:"index of"', compat: 'Google, Bing; variable on DuckDuckGo', group: 'Content' },
    { op: 'allintitle:', syntax: 'allintitle:kw1 kw2', desc: 'Match multiple terms in the title.', example: 'allintitle:index of backup', compat: 'Google; limited elsewhere', group: 'Content' },
    { op: 'intext:', syntax: 'intext:"phrase"', desc: 'Match a term/phrase in page body text.', example: 'intext:"responsible disclosure"', compat: 'Google, Bing; variable on DuckDuckGo', group: 'Content' },
    { op: 'allintext:', syntax: 'allintext:kw1 kw2', desc: 'Match multiple terms in body text.', example: 'allintext:security contact', compat: 'Google; limited elsewhere', group: 'Content' },
    { op: 'filetype:', syntax: 'filetype:pdf', desc: 'Filter by file type/extension.', example: 'site:example.com filetype:pdf', compat: 'Google, Bing; variable on DuckDuckGo', group: 'File' },
    { op: 'ext:', syntax: 'ext:sql', desc: 'Filter by file extension (similar to filetype).', example: 'site:example.com ext:sql', compat: 'Google, Bing; variable on DuckDuckGo', group: 'File' },
    { op: 'cache:', syntax: 'cache:example.com', desc: 'View cached copy of a page (where supported).', example: 'cache:example.com', compat: 'Google (may be limited/unavailable)', group: 'Domain' },
    { op: '"phrase"', syntax: '"exact phrase"', desc: 'Match an exact phrase.', example: '"internal use only"', compat: 'Broadly supported', group: 'Content' },
    { op: 'OR / |', syntax: 'term1 OR term2', desc: 'Match either term.', example: 'login OR signin', compat: 'Broadly supported (syntax varies)', group: 'Modifiers' },
    { op: '-', syntax: '-term', desc: 'Exclude a term.', example: 'site:example.com -www', compat: 'Broadly supported', group: 'Modifiers' },
    { op: '*', syntax: 'site:*.example.com', desc: 'Wildcard placeholder (engine-dependent).', example: 'site:*.example.com', compat: 'Limited/variable; not guaranteed', group: 'Modifiers' },
    { op: '( )', syntax: '(a OR b) c', desc: 'Group terms.', example: '(inurl:dev OR inurl:staging)', compat: 'Broadly supported', group: 'Modifiers' },
    { op: 'after:', syntax: 'after:2024-01-01', desc: 'Date filter (where supported).', example: 'site:example.com after:2024-01-01', compat: 'Google/Bing support varies; may be ignored', group: 'Date' },
    { op: 'before:', syntax: 'before:2024-12-31', desc: 'Date filter (where supported).', example: 'site:example.com before:2024-12-31', compat: 'Google/Bing support varies; may be ignored', group: 'Date' }
  ];

  window.DT_DATA = { ENGINES, MODULES, QUERIES, PLAYBOOKS, OPERATORS };
})();
