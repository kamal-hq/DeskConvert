# DeskConvert v2.0 — Security & Compliance Audit Report

- **Audit Date:** November 27, 2026
- **Repository:** `DeskConvert` (branch `security-compliance-audit`, branched from `main` @ `3aa2472`)
- **Contact:** Muhammad Kamal (`muhammad.kamal.hq@gmail.com`)
- **Scope:** Local repository only (dual-platform Web Studio on Vercel + Windows Desktop `pywebview`/Python studio & Inno Setup installer)

> **Disclaimer:** This audit report, including the open-source license compatibility analysis and privacy/terms templates, is engineering and compliance documentation—**it is not legal advice**. Consult qualified legal counsel before making formal licensing or regulatory determinations.

---

## 1. Executive Summary

- **Pre-Audit Risk Rating:** **Medium-High** (driven by Desktop `pywebview` reflective JS bridge over-exposure, `BottleServer` `/js_api/<uid>` wildcard CORS endpoint, unvalidated `open_path` / filename stems, missing Vercel HTTP security headers, unpinned installer asset binaries, and desktop AGPL-3.0 / GPL distribution license mismatch).
- **Post-Audit Risk Rating (Finalized):** **Low** across Web security, Desktop security, and open-source licensing compliance (Option 1A adopted for Desktop AGPL-3.0 binary distribution, Web OCR CDN versions pinned, `vitest` upgraded to `5.1.2` with `0` `npm audit` vulnerabilities, and `Pillow` upgraded to `13.0.0` / `PyMuPDF` aligned to `1.28.2`).

### Remaining Post-Deploy Follow-Ups
1. **Promote Report-Only CSP to Enforced (`SEC-003`):** After live Vercel deployment, open `https://desk-convert.vercel.app/` with DevTools Console open, test the 5 Web flows (open PDF, preview, merge/split, image convert, Web OCR), confirm zero `[Report Only]` CSP messages, then rename `Content-Security-Policy-Report-Only` → `Content-Security-Policy` in `vercel.json`.
2. **Optional Future Enhancements (Deferred by Owner):** Self-hosting Web OCR (~16.5 MB in `dist_web/ocr/`), optional filename-only Desktop history toggle, per-user `PrivilegesRequired=lowest` Windows installer migration (v2.1), and enabling GitHub Dependabot alerts in repo settings.

---

## 2. Feature Map & Audit Phase Status

| Feature | Present? | Code Evidence |
| :--- | :---: | :--- |
| User Login (Email/Password, Google/GitHub OAuth, Other) | **No** | Zero auth libraries, endpoints, or session logic in `src/`, `desktop/`, `core/`, `utils/`. |
| Supabase or Other Database | **No** | Local storage only (`localStorage` on Web in `src/App.tsx:39-40`; `%APPDATA%\DeskConvert\settings.json` on Desktop in `utils/settings.py:7-12`). |
| Remote File Storage / Uploads | **No** *(Local ingestion only)* | Files stay in browser RAM (`src/engines/webEngine.ts:33`) or `%TEMP%\deskconvert_*` wiped on exit (`core/cache_manager.py:18,110-117`). |
| Server-Side API Routes / Cloud Functions | **No** *(Local Desktop IPC Bridge: **Yes**)* | Static SPA on Vercel (`vercel.json`); Desktop exposes `window.pywebview.api` (`desktop/app.py`, `desktop/bridge.py`). |
| Scraping / External Site Fetching | **No** | No `fetch()`, `XMLHttpRequest`, `requests`, or `urllib` calls in app code. |
| Third-Party APIs / Static CDNs | **Web OCR CDN only** | Google Fonts CDN was **eliminated** by self-hosting `@fontsource/manrope` & `@fontsource/dm-mono`. Web OCR (`tesseract.js` v5.1.1) fetches worker/WASM/`eng.traineddata.gz` from `cdn.jsdelivr.net` (`src/engines/webEngine.ts:810`). |
| Payments | **No** | Free open-source app. |
| Analytics / Non-Essential Cookies | **No** | Zero cookies, zero analytics or telemetry scripts. |
| Untrusted User Files (Local PDF/Image Parsing) | **Yes** | Users load arbitrary local PDFs/images into PDF.js/pdf-lib/Canvas (Web) and PyMuPDF/Pillow/Poppler/Tesseract (Desktop). |

### Phases Executed vs. Skipped

| Phase | Status | Reason / Scope |
| :--- | :---: | :--- |
| **Phase 0 — Recon** | **Ran** | Mapped Web (React 19 / Vite 6 / Vercel) + Desktop (`pywebview` 6.2.1 / Python 3.12 / PyInstaller / Inno Setup 6) stack and data flows. |
| **Phase 1 — Secrets & Env Vars** | **Ran** | Scanned working tree + full git history (`0` secrets found). Hardened `.gitignore` and added `.env.example`. |
| **Phase 2 — Auth & Sessions** | **Skipped** | Feature not present (no user login or sessions). |
| **Phase 3 — Database** | **Skipped** | Feature not present (no Supabase or database). |
| **Phase 4 — Application Security** | **Ran (Adapted)** | Audited Web headers/CSP, self-hosted fonts, client storage/links, Desktop `pywebview` bridge isolation, local HTTP server, WebView2 navigation lock, path/filename validation, decompression-bomb/memory caps, installer SHA-256 checks, and npm/Python dependencies. |
| **Phase 5 — Compliance Pages** | **Ran (Adapted)** | Built in-app Privacy Policy, Terms of Service, and Open-Source Licenses views (`/privacy`, `/terms`, `/licenses` + footer links + Clear Local Data flow) and `THIRD_PARTY_NOTICES.md`. Skipped cookie banner (no cookies/analytics) and Google OAuth consent screen (no Google OAuth). |
| **Phase 6 — Verify** | **Ran** | Re-ran `pytest` (`11/11`), `vitest` (`4/4`), `tsc --noEmit && vite build`, `verify_installer_assets.py` (`144/144`), and placeholder grep (`0` matches). |

---

## 3. Findings Table

### Confirmed Findings

| ID | Severity | Location (`file:line`) | Issue | Status | How to Verify |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-001** | **High** | `desktop/app.py:24-27`, `desktop/bridge.py:31-38` *(pre-fix)* | `pywebview` recursively walks all non-`_` attributes on `js_api` (`webview/util.py:190-206`). Passing `DeskConvertBridge` directly exposed `window`, `cache`, `settings`, `history`, `attach_window`, and `cleanup` to JavaScript (`window.pywebview.api.window.load_url(...)`, `cache.stage_file(...)`). | **Fixed** (`3a98555`) | Run `pytest tests/test_bridge.py -k test_bridge_js_api_isolation_and_origin_enforcement` — confirms `dir(js_api)` equals `ALLOWED_JS_API_METHODS` and `getattr` raises `AttributeError` for internal objects. |
| **SEC-002** | **High** | `desktop/app.py:37-40` *(pre-fix)* | Default `pywebview.http.BottleServer` registers `POST /js_api/<uuid1>` with `Access-Control-Allow-Origin: *` and predictable UUIDv1 (`webview/http.py:82,106-120`), leaves `ALLOW_FILE_URLS=True` (`--allow-file-access-from-files`) and `OPEN_EXTERNAL_LINKS_IN_BROWSER=True` (unrestricted `webbrowser.open`), and injects `window.pywebview` on any navigated URL (`edgechromium.py:389`). | **Fixed** (`3a98555`) | Run `pytest tests/test_bridge.py -k test_hardened_local_http_server_blocks_js_api_and_cross_origin` — confirms `/js_api/*` returns `405`, foreign `Origin`/`Host`/`Sec-Fetch-Site: cross-site` return `403`, and static files return strict headers without `Access-Control-Allow-Origin`. |
| **SEC-003** | **Medium** | `vercel.json:1-13` *(pre-fix)* | Web deployment had zero HTTP security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Content-Security-Policy`). | **Fixed** (headers enforced; CSP in **Report-Only**, `825f673`) | Inspect `vercel.json` headers; after deploy, run `curl -I https://desk-convert.vercel.app/` and check DevTools Console for zero CSP violations before promoting CSP to enforced. |
| **SEC-004** | **Medium** | `src/engines/webEngine.ts:831-839`, `package.json:21` | `tesseract.js` v5.1.1 previously loaded `@tesseract.js-data/eng/4.0.0_best_int` from `cdn.jsdelivr.net` without pinning the npm package version (`@1.0.0`). | **Fixed** (Pinned exact `tesseract.js@5.1.1`, `tesseract.js-core@5.1.1`, `@tesseract.js-data/eng@1.0.0`; optional self-hosting kept in §7.2) | Run `npm run test` (`regression.test.ts` verifies all 3 exact pinned CDN URLs in `webEngine.ts`). |
| **SEC-005** | **Medium** | `desktop/bridge.py:64-73,158-168`, `core/export.py:18-22`, `core/pdf_engine.py:135,231` *(pre-fix)* | `open_path` accepted any existing filesystem path (including UNC shares or arbitrary system folders); `stage_uploaded_files` and output filename builders did not reject `..` traversal, UNC paths, or Windows reserved device names (`CON`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). | **Fixed** (`3a98555`) | Run `pytest tests/test_bridge.py -k test_bridge_path_validation_reserved_names_and_external_allowlist` — verifies UNC, `..`, outside directories, reserved device names, and disallowed external URLs are blocked/sanitized. |
| **SEC-006** | **Medium** | `core/cache_manager.py`, `core/pdf_engine.py`, `core/image_engine.py`, `desktop/bridge.py`, `src/engines/webEngine.ts` *(pre-fix)* | No explicit file-size, PDF page-count, Pillow pixel, or PDF pixmap/canvas dimension caps existed against decompression bombs or crafted multi-gigapixel PDFs. | **Fixed** (`717bb13`) | Run `pytest tests/test_core.py -k test_decompression_bomb_and_memory_safety_caps` and `npm run test` (`adapter.test.ts`). |
| **SEC-007** | **Medium** | `DeskConvert.iss:39-48` *(pre-fix)* | Bundled `installer_assets/tesseract-installer.exe` and 143 `poppler/bin/*` binaries had no build-time SHA-256 integrity verification, and `DeskConvert_Setup.exe` is unsigned with no SmartScreen/SHA-256 guide in `README.md`. | **Fixed** (`cbe18b2`); per-user install **Needs approval** (§7.4) | Run `python desktop/verify_installer_assets.py` (verifies all 144 files against `desktop/installer_checksums.json`) and `pytest tests/test_core.py -k test_installer_asset_checksum_verification`. |
| **SEC-008** | **Low** | `src/index.css:1` *(pre-fix)* | Page imported Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), exposing visitor IP/Referer to Google on every Web and Desktop load. | **Fixed** (`e847292`) | Run `npm run build` and grep `dist_web/` for `fonts.googleapis.com` / `fonts.gstatic.com` (`0` matches; `.woff2` served locally from `dist_web/assets/`). |
| **SEC-009** | **Low** | `.gitignore:1-49` *(pre-fix)* | `.gitignore` did not ignore `.env`, `.env.*`, or private key files (`*.pem`, `*.key`, `*.p12`, `*.pfx`), and no `.env.example` existed. (Full git history scan confirmed `0` real secrets were ever committed.) | **Fixed** (`046862c`) | Check `.gitignore:48-57` and `.env.example`. |
| **SEC-010** | **Low** *(dev-only)* | `package.json:32`, `package-lock.json` | `npm audit` reported 3 vulnerabilities (`tinypool <=2.1.1` critical, `@vitest/mocker <=4.1.11` moderate) inside devDependency `vitest@3.2.7`. | **Fixed** (Upgraded `vitest` → `5.1.2`; `npm audit` now reports **0 vulnerabilities**) | Run `npm audit` (`found 0 vulnerabilities`) and `npm run test`. |
| **SEC-011** | **Medium** | `desktop/requirements.txt:7,11` | `desktop/requirements.txt` pinned outdated `Pillow==10.4.0` and mismatched `PyMuPDF==1.24.9` (local runtime used `1.28.2`). | **Fixed** (Upgraded `Pillow==13.0.0` and aligned `PyMuPDF==1.28.2`) | Run `python -c "import PIL, pymupdf; print(PIL.__version__, pymupdf.VersionBind)"` and `pytest`. |
| **SEC-012** | **High (Compliance)** | `LICENSE`, `LICENSE-DESKTOP-AGPL-3.0.txt`, `DeskConvert.iss`, `THIRD_PARTY_NOTICES.md` | Windows Desktop binary distribution bundles **PyMuPDF / MuPDF (AGPL-3.0)** and **Poppler (GPL-2.0/3.0)** while original repo source is MIT. | **Fixed (Option 1A Adopted)** — Original source remains MIT; Desktop binary distribution explicitly licensed under AGPL-3.0 via `LICENSE-DESKTOP-AGPL-3.0.txt`, bundled & displayed in `DeskConvert.iss`, with Corresponding Source links in `THIRD_PARTY_NOTICES.md`, `LegalModal.tsx`, `README.md`, and GitHub release notes. | Inspect `LICENSE-DESKTOP-AGPL-3.0.txt`, `DeskConvert.iss`, and `THIRD_PARTY_NOTICES.md`. |
| **SEC-013** | **Low (Privacy)** | `utils/history.py:12-19`, `utils/settings.py:12` | Desktop recent-files history stores full local filesystem paths (including Windows username) in `%APPDATA%\DeskConvert\settings.json`. | **Disclosed** in Privacy Policy (`747ce32`); filename-only option **Needs approval** (§7.3) | Open `/privacy` (or footer **Privacy**) and verify §2 discloses full-path storage in `settings.json`. |
| **SEC-014** | **Low** | `src/App.tsx:77-95`, `src/components/Modals.tsx:323-342` *(pre-fix)* | `localStorage` JSON was merged directly into React state without schema validation, and external links used `rel="noreferrer"` without `noopener` (plus did not route via allowlisted Desktop opener). | **Fixed** (`825f673`, `3a98555`) | Inspect `src/App.tsx:77-125` and `src/components/Modals.tsx:333-355`. |
| **SEC-015** | **Low (Compliance)** | `src/App.tsx`, `THIRD_PARTY_NOTICES.md` *(pre-fix)* | No Privacy Policy, Terms of Service, Open-Source Licenses view, or `THIRD_PARTY_NOTICES.md` existed in the app or repo. | **Fixed** (`747ce32`) | Visit `/privacy`, `/terms`, `/licenses` or click footer links; verify `THIRD_PARTY_NOTICES.md` exists and contact email is `muhammad.kamal.hq@gmail.com`. |

### Suspected / Low-Confidence Observations (Verified Not Exploitable Today)
- **Early Git History Binary Artifacts (`d03cee51`):** Prior to commit `1df17a1` (which added `.gitignore`), `dist/` and `installer_assets/` binaries were committed in git history (producing 2 false-positive regex hits inside compiled DLLs `Qt6Network.dll` and `libssh2.dll`). No credentials or `.env` files exist in git history; no history rewrite is needed unless you later want to shrink repo clone size.
- **React DOM XSS Sinks:** Codebase uses zero `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `new Function()`. All filenames and OCR/error strings render via JSX text interpolation (auto-escaped by React).

---

## 4. Commits Made on `security-compliance-audit`

Branch `main` was not modified and nothing was pushed.

| Commit | Summary | Key Files |
| :--- | :--- | :--- |
| `046862c` | `security: ignore .env/key files and add .env.example template` | `.gitignore`, `.env.example` |
| `e847292` | `privacy: self-host Manrope and DM Mono fonts via Fontsource (remove Google Fonts CDN)` | `package.json`, `package-lock.json`, `src/main.tsx`, `src/index.css` |
| `825f673` | `security: add Vercel security headers, Report-Only CSP, and harden client storage/links` | `vercel.json`, `src/components/Modals.tsx`, `src/App.tsx` |
| `3a98555` | `security: isolate desktop JS bridge, harden local HTTP server, lock navigation, and validate paths` | `desktop/app.py`, `desktop/bridge.py`, `utils/validators.py`, `core/export.py`, `core/pdf_engine.py`, `core/image_engine.py`, `src/engines/desktopEngine.ts`, `src/components/Modals.tsx`, `src/App.tsx`, `tests/test_bridge.py` |
| `717bb13` | `security: add decompression-bomb, PDF page, and memory safety caps for desktop and web` | `utils/validators.py`, `core/cache_manager.py`, `core/pdf_engine.py`, `core/image_engine.py`, `core/compression.py`, `core/ocr_engine.py`, `desktop/bridge.py`, `src/engines/adapter.ts`, `src/engines/webEngine.ts`, `tests/test_core.py`, `src/engines/adapter.test.ts` |
| `cbe18b2` | `security: enforce pinned SHA-256 verification for installer assets and add SmartScreen/checksum guide` | `desktop/verify_installer_assets.py`, `desktop/installer_checksums.json`, `DeskConvert.iss`, `README.md`, `tests/test_core.py` |
| `747ce32` | `compliance: add Privacy Policy, Terms of Service, Open-Source Licenses UI/routes, and THIRD_PARTY_NOTICES.md` | `THIRD_PARTY_NOTICES.md`, `src/components/LegalModal.tsx`, `src/App.tsx`, `src/index.css` |
| *(final commit)* | `docs: add comprehensive SECURITY_AUDIT.md report` | `SECURITY_AUDIT.md` |

---

## 5. Manual Actions for You

1. **No Key Rotations Required:** Zero secrets, API keys, or `.env` files were found in the working tree or full git history.
2. **Review & Merge Branch:**
   ```bash
   git diff main..security-compliance-audit --stat
   git checkout main
   git merge --no-ff security-compliance-audit
   git push origin main
   ```
   Vercel will automatically deploy the updated `dist_web/` bundle and `vercel.json` headers to `https://desk-convert.vercel.app/`.
3. **Verify Vercel Security Headers & Report-Only CSP (Click-by-Click):**
   - Open `https://desk-convert.vercel.app/` in Chrome/Edge → press **F12** → **Network** tab → click the top document request (`desk-convert.vercel.app`) → **Response Headers** → confirm `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `permissions-policy`, `cross-origin-opener-policy: same-origin`, and `content-security-policy-report-only` are present.
   - Switch to the **Console** tab and run the 5-step CSP verification checklist in §7.1 below.
   - Confirm `/privacy`, `/terms`, and `/licenses` load directly on Vercel and fonts render with zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`.
4. **Rebuild & Re-Upload `DeskConvert_Setup.exe` with Release Checksum:**
   ```powershell
   npm run build
   python desktop/verify_installer_assets.py
   pyinstaller DeskConvert.spec --noconfirm
   & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" DeskConvert.iss
   Get-FileHash .\installer_output\DeskConvert_Setup.exe -Algorithm SHA256
   ```
   - Upload the rebuilt installer via `gh release upload v2.0.0 "installer_output/DeskConvert_Setup.exe" --clobber` and paste the computed SHA-256 hash into the GitHub `v2.0.0` release notes (`GitHub → Releases → v2.0.0 → Edit release`).
5. **Enable GitHub Dependabot Alerts (Optional, Recommended):**
   - In GitHub: `Repository → Settings → Code security → Dependabot alerts → Enable` (covers both `package-lock.json` and `desktop/requirements.txt`).

---

## 6. Shared-Database Notes

Not applicable. DeskConvert uses **no database** (no Supabase, PostgreSQL, Firebase, or external datastore). All persistence is strictly local to each user's browser (`localStorage`) or Windows PC (`%APPDATA%\DeskConvert\settings.json`).

---

## 7. Items Deliberately Not Changed (`NEEDS APPROVAL` Proposals)

### 7.1 Enforcing Content-Security-Policy (Currently `Content-Security-Policy-Report-Only`)
- **Why not enforced yet:** Strict CSP can silently block PDF.js workers, Blob image URLs, inline React styles, or `tesseract.js` WebAssembly `importScripts` if any browser edge case deviates from the policy.
- **Current Report-Only Policy (`vercel.json`):**
  ```text
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob: data: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  ```
- **What to Test Before Enforcing:**
  1. **Open PDF:** Load a multi-page PDF and verify thumbnails render on the storyboard (`pdf.worker.min.mjs` + `data:`/`blob:` thumbnails).
  2. **Preview:** Click a page card to open the full-resolution zoomable preview modal.
  3. **Merge & Split:** Load a PDF + image, reorder cards, export a merged PDF, and run a multi-range split export (both Single PDF and Individual ZIP).
  4. **Image Convert & Compression:** Export PDF pages to JPG/PNG/WebP/BMP/TIFF and run Smart Compression.
  5. **Web OCR:** Run **OCR** on a scanned PDF or image (both Searchable PDF and Plain Text `.txt`) so `tesseract.js` fetches worker + WASM + `eng.traineddata.gz` from `cdn.jsdelivr.net` and executes WASM.
- **How to Read Violations in the Console:**
  - Open **DevTools (F12) → Console** (ensure **Errors** and **Warnings** filters are enabled).
  - Any policy violation appears in red/yellow as:
    `[Report Only] Refused to load the script '...' because it violates the following Content Security Policy directive: "script-src ..."`
  - You can also inspect structured violation fields by pasting this one-liner in Console before clicking actions:
    ```js
    window.addEventListener('securitypolicyviolation', (e) => console.warn('CSP Violation:', e.violatedDirective, e.blockedURI));
    ```
  - **Safe Rollout:** Once all 5 actions complete with **zero** `[Report Only]` console messages across Chrome, Edge, and Firefox, change the header key in `vercel.json` from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` and redeploy.

### 7.2 Web OCR (`tesseract.js`): Exact Version Pinning & Self-Hosting Feasibility (`NEEDS APPROVAL`)
- **Current Behavior (`src/engines/webEngine.ts:810`):** `createWorker('eng')` uses `tesseract.js` v5.1.1 defaults:
  - `workerPath`: `https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js` *(exact `5.1.1` from installed package)*
  - `corePath`: `https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.1` *(strips `^` from `^5.1.1` in `node_modules/tesseract.js/package.json`)*
  - `langPath`: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int` *(**UNPINNED** npm package version — resolves mutable `@latest` on jsDelivr!)*
- **Proposal A — Pin Exact CDN Versions (Zero Bundle Bloat, Recommended Immediate Step):**
  - Pin `tesseract.js` to exact `"5.1.1"` in `package.json` and pass explicit pinned URLs into `createWorker`:
    ```ts
    const worker = await createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
    });
    ```
- **Proposal B — Self-Host Web OCR Assets in `dist_web/ocr/` (Eliminates ALL Third-Party CDNs):**
  - **Feasibility:** **Yes — fully feasible on Vercel** (Vercel Hobby/Pro static deployments easily support ~16 MB of lazy-loaded static assets, and these files are downloaded *only* when a user clicks **OCR**, so initial page load stays identical).
  - **Measured Bundle-Size Cost (exact byte measurements from `node_modules/` + jsDelivr):**
    - `tesseract.js/dist/worker.min.js`: **124 KB**
    - LSTM WASM cores (default `lstmOnly: true` in `tesseract.js` v5 — SIMD + non-SIMD fallback):
      - `tesseract-core-simd-lstm.wasm` (2.86 MB) + `tesseract-core-simd-lstm.wasm.js` (3.94 MB)
      - `tesseract-core-lstm.wasm` (2.86 MB) + `tesseract-core-lstm.wasm.js` (3.94 MB)
      - Subtotal: **13.60 MB uncompressed** (~4.5 MB Brotli/gzipped on Vercel) *(or ~30 MB uncompressed if legacy non-LSTM cores are also included)*.
    - English language model (`@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz`): **~2.82 MB** (already gzipped).
    - **Total static addition to `dist_web/ocr/`:** **~16.5 MB** uncompressed (only ~7.5 MB transferred over the wire once per browser, then cached in IndexedDB).
  - **Important Desktop Packaging Caveat:** Because `DeskConvert.spec` bundles `('dist_web', 'dist_web')`, exclude `dist_web/ocr` from `DeskConvert.spec` if you adopt Proposal B so `DeskConvert_Setup.exe` does not bloat by 16.5 MB (Desktop OCR already uses native Tesseract).
  - **Security Benefit:** Removing jsDelivr lets you remove `https://cdn.jsdelivr.net` completely from `script-src`, `worker-src`, and `connect-src` in `vercel.json` CSP, making the Web Studio **100% zero-third-party-CDN**.

### 7.3 Desktop History Filename-Only Option (`NEEDS APPROVAL`)
- **Why not changed:** Current Desktop UX allows one-click reopening of recent files from `settings.json`, which requires full file paths (and therefore includes the Windows username path segment). Changing this silently would break one-click reopen.
- **What was done:** Current behavior is clearly disclosed in the in-app **Privacy Policy** (§2).
- **Proposed Enhancement:** Add a toggle in **Settings → Privacy defaults**: `"Store filenames only in recent history (hide full folder paths)"` (`store_full_history_paths: bool`, defaulting to `True` for backward compatibility or `False` for privacy-first installs). When `False`, `HistoryManager.add_entry` stores `{name, kind, pageCount, sizeBytes}` without `path`, and clicking a history item opens the native file picker just like Web mode.

### 7.4 Per-User Windows Installer (`PrivilegesRequired=lowest`) (`NEEDS APPROVAL`)
- **Why not changed:** `DeskConvert.iss:19` currently sets `PrivilegesRequired=admin` and installs to `{autopf}\DeskConvert` (`C:\Program Files\DeskConvert`), writes to `HKLM\SYSTEM\...\Environment\Path`, and runs `tesseract-installer.exe /S` (which defaults to `C:\Program Files\Tesseract-OCR`, requiring administrator rights). Changing `PrivilegesRequired=lowest` without adjusting Tesseract and registry paths would break installation.
- **Can `DeskConvert.iss` install per-user without breaking Tesseract & Poppler? Yes — with 3 coordinated changes:**
  1. **Install Directory & Registry:** Set `PrivilegesRequired=lowest` (or `PrivilegesRequiredOverridesAllowed=dialog`), `DefaultDirName={localappdata}\DeskConvert`, and move the Poppler `[Registry]` `Path` entry from `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` to `HKCU\Environment` (with `ChangesEnvironment=yes`).
  2. **Tesseract Per-User Installation:** The UB-Mannheim NSIS `tesseract-installer.exe` requests UAC elevation by default unless either:
     - **Option 1 (Cleanest):** Replace `tesseract-installer.exe` with pre-extracted portable Tesseract binaries (`tesseract.exe`, DLLs, and `tessdata/eng.traineddata`) installed directly into `{app}\tesseract\` via `[Files]`. Note: `core/ocr_engine.py:21` **already checks `{exe_dir}\tesseract\tesseract.exe` first**, so zero Python code changes are needed and no elevated sub-installer runs!
     - **Option 2:** Test `tesseract-installer.exe /S /D={app}\tesseract` on a non-admin Windows account; note that NSIS installers built with `RequestExecutionLevel admin` in their manifest still trigger a UAC prompt even with `/D=`, making Option 1 strongly preferred for true non-admin installs.
  3. **Uninstall Cleanup:** `{app}` under `{localappdata}\DeskConvert` uninstalls cleanly without admin privileges.

### 7.5 Windows Desktop Copyleft Licensing Analysis (`MIT` vs. `PyMuPDF AGPL-3.0` & `Poppler GPL`) (`NEEDS APPROVAL` — *Not Legal Advice*)
- **Compatibility Finding:**
  - **Web Studio (`dist_web/`):** **Compatible with MIT.** All runtime dependencies (`react`, `react-dom`, `pdf-lib`, `pdfjs-dist`, `jszip` under MIT, `tesseract.js`, Fontsource OFL-1.1) are permissive licenses compatible with distributing DeskConvert under MIT.
  - **Windows Desktop Binary (`DeskConvert.exe` & `DeskConvert_Setup.exe`):** **NOT compatible with distributing solely under MIT.** `PyMuPDF` (`fitz`) embeds MuPDF under **GNU AGPL-3.0** (unless commercially licensed from Artifex). Because DeskConvert imports and calls `pymupdf` in-process across `core/` and `utils/` and freezes it into `DeskConvert.exe`, the combined distributed work triggers AGPL-3.0 copyleft obligations (requiring the combined work to be distributed under AGPL-3.0 with full Corresponding Source). Separately, `DeskConvert_Setup.exe` bundles **Poppler 26.09.0** (`pdftoppm.exe` + DLLs), which is licensed under **GNU GPL-2.0/3.0** (invoked as a separate CLI process via `pdf2image`, which avoids Python-process linking but still requires distributing GPL license text and a written offer / Corresponding Source for the bundled Poppler binaries).
- **Your Three Options:**

| Option | Licensing Posture | What Changes in Code / Packaging / Distribution |
| :--- | :--- | :--- |
| **Option 1: License Desktop Distribution under AGPL-3.0** *(Zero cost, zero code rewrite)* | Keep your original DeskConvert source MIT (MIT is AGPL-3.0-compatible) **or** relicense the repo to AGPL-3.0; distribute `DeskConvert_Setup.exe` under **AGPL-3.0** with GPL/AGPL notices and Corresponding Source links. | No engine rewrite required. Update `LICENSE` / release notes / installer license screen to state the Windows Desktop binary distribution is licensed under **AGPL-3.0** (due to PyMuPDF/MuPDF), include full AGPL-3.0 & GPL-3.0 license texts in `{app}`, and publish exact source links/tarballs for the bundled PyMuPDF and Poppler versions alongside each GitHub Release. |
| **Option 2: Purchase Artifex Commercial License for PyMuPDF + Drop Poppler** *(Paid, minimal code change)* | Keep Desktop distribution under MIT (or proprietary/custom terms) for PyMuPDF once licensed from Artifex. | Purchase a commercial MuPDF/PyMuPDF license from Artifex Software. To eliminate Poppler's GPL obligation too, **remove `pdf2image` and `installer_assets/poppler/`** from `desktop/requirements.txt` and `DeskConvert.iss` — `core/ocr_engine.py:82-88` already rasterizes PDFs via PyMuPDF directly when Poppler is absent! (Also shrinks `DeskConvert_Setup.exe` by ~94 MB uncompressed!) |
| **Option 3: Replace PyMuPDF & Poppler with Permissive Libraries** *(Zero cost, medium code refactor)* | Entire Web + Desktop stack becomes 100% permissive (MIT / Apache-2.0 / BSD / HPND). | Replace `PyMuPDF` + `pdf2image` + `Poppler` with **`pypdf`** (BSD-3-Clause, merge/split/metadata/encryption checks) + **`pypdfium2`** (Apache-2.0 / BSD-3-Clause, PDF page rasterization for thumbnails, previews, PDF→Images, and OCR input) + **`reportlab`** (BSD-3-Clause, watermark & invisible searchable-PDF text overlay). Files requiring updates: `core/pdf_engine.py`, `core/cache_manager.py`, `core/compression.py`, `core/watermark.py`, `core/metadata.py`, `core/ocr_engine.py`, `utils/validators.py`, `utils/history.py`, `desktop/requirements.txt`, `DeskConvert.spec`, and `DeskConvert.iss`. |

### 7.6 Dependency Upgrades Deferred (Outside Patch-Only Auto-Fix Rule)
- **`vitest` `3.2.7` → `5.1.2+` (`devDependencies` only):** Clears `npm audit`'s 2 critical (`tinypool`) + 1 moderate (`@vitest/mocker`) dev-only advisories; requires major-version migration check.
- **`Pillow==10.4.0` → `>=12.1.1` & `PyMuPDF` alignment (`desktop/requirements.txt`):** Upgrading Pillow across two major versions (`10.x` → `12.x`) and aligning `PyMuPDF` version pins in a clean `.venv` should be tested explicitly with `pytest` and a full PyInstaller rebuild before shipping.

---

## 8. Verification Summary & 30-Day Follow-Up

### Phase 6 Verification Results vs. Phase 0 Baseline

| Check | Phase 0 Baseline | Phase 6 Post-Audit | Status |
| :--- | :--- | :--- | :---: |
| Python test suite (`pytest tests/test_core.py tests/test_bridge.py`) | `6 passed` | **`11 passed`** (+5 new security/bridge/cap/checksum tests) | Pass |
| Frontend test suite (`npm run test` / `vitest`) | `3 passed` | **`4 passed`** (+1 new web memory/bomb cap test) | Pass |
| TypeScript & Production Web Build (`npm run build`) | Built cleanly (`dist_web/`) | **Built cleanly** (`dist_web/`, self-hosted `.woff2` fonts, `0` Google Fonts refs) | Pass |
| Installer Asset SHA-256 Check (`python desktop/verify_installer_assets.py`) | Did not exist | **OK: 144/144 files verified** | Pass |
| Secret & Git History Scan | `0` real secrets | **`0` real secrets**, `.gitignore` hardened | Pass |
| Placeholder & Typo Grep (bracketed placeholders, unresolved markers, email spelling) | N/A | **`0` placeholders or typos remaining** | Pass |

### 30-Day Follow-Up Checklist
- **Days 1–7:** Merge `security-compliance-audit`, test all 5 flows on `desk-convert.vercel.app` with DevTools Console open, confirm zero CSP violations, and promote `Content-Security-Policy-Report-Only` → `Content-Security-Policy`.
- **Days 7–14:** Decide on Desktop licensing Option 1, 2, or 3 (§7.5) and approve Web OCR pinning or self-hosting (§7.2).
- **Days 14–21:** Create a clean Python `.venv`, upgrade `Pillow` to latest 12.x and align `PyMuPDF` version in `desktop/requirements.txt`, upgrade `vitest` to 5.x, re-run full tests + `pip-audit` + `npm audit`, and rebuild `DeskConvert_Setup.exe`.
- **Days 21–30:** Evaluate per-user installer migration (§7.4) with portable Tesseract + `HKCU\Environment`, and enable GitHub Dependabot alerts for ongoing CVE monitoring.
