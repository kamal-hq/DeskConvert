# DeskConvert — Pre-Merge Regression & Manual Test Checklist

- **Branch Audited:** `security-compliance-audit` (branched from `main` @ `3aa2472`)
- **Date:** November 27, 2026
- **Goal:** Verify zero regressions across Web Studio and Windows Desktop before merging into `main`, document every hardened boundary with an under-2-minute quick test, confirm ENFORCED vs. Report-Only headers by file, and catalog every user-visible behavior difference from `main`.

---

## 1. Commit Map (`main..security-compliance-audit`)

| Commit | Summary | Files Touched | Potential User-Facing Impact |
| :--- | :--- | :--- | :--- |
| `046862c` | Ignore `.env`/key files & add `.env.example` | `.gitignore`, `.env.example` | None at runtime (repo hygiene only). |
| `e847292` | Self-host `Manrope` & `DM Mono` via Fontsource (remove Google Fonts CDN) | `package.json`, `package-lock.json`, `src/main.tsx`, `src/index.css` | Typography & weights (400–700 Manrope, 400–500 DM Mono); removes all `fonts.googleapis.com` / `fonts.gstatic.com` network calls. |
| `825f673` | Add Vercel security headers + Report-Only CSP; harden `localStorage` & links | `vercel.json`, `src/App.tsx`, `src/components/Modals.tsx` | Vercel response headers & Report-Only CSP; `localStorage` parsing on load; `rel="noopener noreferrer"` on Download modal links. |
| `3a98555` | Isolate Desktop JS bridge (`DeskConvertJsApi`), harden local HTTP server (`DeskConvertLocalServer`), lock WebView2 navigation, validate paths/filenames | `desktop/app.py`, `desktop/bridge.py`, `utils/validators.py`, `core/export.py`, `core/pdf_engine.py`, `core/image_engine.py`, `src/engines/desktopEngine.ts`, `src/components/Modals.tsx`, `src/App.tsx`, `tests/test_bridge.py` | Every Desktop bridge call, local asset serving in WebView2, Desktop `Open folder` toast button, Desktop external GitHub links, filename sanitization (Windows reserved names & traversal), Desktop `save_settings`. |
| `717bb13` | Add decompression-bomb, PDF page, and memory safety caps (Desktop & Web) | `utils/validators.py`, `core/cache_manager.py`, `core/pdf_engine.py`, `core/image_engine.py`, `core/compression.py`, `core/ocr_engine.py`, `desktop/bridge.py`, `src/engines/adapter.ts`, `src/engines/webEngine.ts`, `tests/test_core.py`, `src/engines/adapter.test.ts` | File ingestion, PDF page count, high-DPI rendering, and drag-and-drop size validation on both Web and Desktop. |
| `cbe18b2` | Enforce pinned SHA-256 verification for bundled installer assets & add SmartScreen guide | `desktop/verify_installer_assets.py`, `desktop/installer_checksums.json`, `DeskConvert.iss`, `README.md`, `tests/test_core.py` | Inno Setup (`iscc DeskConvert.iss`) compile-time asset check and README docs only; zero runtime app change. |
| `747ce32` | Add Privacy Policy, Terms of Service, Open-Source Licenses modal/routes & `THIRD_PARTY_NOTICES.md` | `THIRD_PARTY_NOTICES.md`, `src/components/LegalModal.tsx`, `src/App.tsx`, `src/index.css` | Footer links (`Privacy · Terms · Licenses`), `/privacy`, `/terms`, `/licenses` direct routes, Clear All Local Data button. |
| `f118dc3` | Add `SECURITY_AUDIT.md` audit report | `SECURITY_AUDIT.md` | Documentation only. |
| `dac709c` | Add automated Web + Desktop security regression tests | `tests/test_regression.py`, `src/engines/regression.test.ts` | Test files only. |

---

## 2. Click-by-Click Manual Test Checklist (Every User-Facing Feature)

Run **Web Studio** locally (`npm run preview`) or on a Vercel Preview deployment for `security-compliance-audit`, and run **Windows Desktop** locally (`python desktop/main.py` after `npm run build`).

### A. App Launch, Theme & Self-Hosted Fonts — *Tagged: `e847292`, `825f673`, `3a98555`*
- [ ] **A1 (Web):** Open app in Chrome/Edge with **DevTools (F12) → Network** tab open. Reload (`Ctrl+Shift+R`). Confirm `Manrope` body text and `DM Mono` badges/labels render identically to `main`, `.woff2` files load from `/assets/`, and **zero** requests go to `fonts.googleapis.com` or `fonts.gstatic.com`.
- [ ] **A2 (Desktop):** Run `python desktop/main.py`. Confirm the native window opens cleanly at `1320×840`, shows `Desktop App v2.0` in the top-right pill, and renders Manrope + DM Mono offline (even with Wi-Fi disabled).
- [ ] **A3 (Both):** Click the **Sun/Moon** theme toggle in the top right → reload/reopen app → confirm chosen Light/Dark theme persists cleanly (`825f673`, `3a98555`).

### B. File & Folder Ingestion — *Tagged: `3a98555`, `717bb13`*
- [ ] **B1 (Browse Files — Both):** Click **+ Browse Files**, select 2 PDFs + 2 images (JPG/PNG) simultaneously. Confirm all pages/images appear as thumbnail cards on the canvas and auto-select `Merge` mode.
- [ ] **B2 (Browse Folder — Both):** Click **Browse Folder** and pick a folder containing nested PDFs, images, and a `.txt` file. Confirm supported files load and a red toast (`Unsupported files skipped`) lists the `.txt` filename.
- [ ] **B3 (Drag-and-Drop — Both):** Drag a PDF and a PNG from Windows Explorer onto the center canvas. Confirm dashed drop overlay appears and cards load cleanly (tests `stage_uploaded_files` base64 path on Desktop).
- [ ] **B4 (Encrypted PDF — Both):** Load a password-protected PDF. Confirm a toast (`Password-protected PDF skipped`) appears without crashing the app.

### C. Storyboard Canvas, Reordering, Selection, Preview & Loaded-Files Popover — *Tagged: `3a98555`, `717bb13`*
- [ ] **C1 (Drag Reorder & Delete/Undo — Both):** Drag card #3 before card #1 → confirm visual order updates. Click the trash icon on a card → press `Ctrl+Z` (or click **Undo delete** in the bottom selection bar) → confirm the card restores to its exact index.
- [ ] **C2 (Full-Res Preview — Both):** Click a page thumbnail (or eye icon) → confirm the preview modal opens sharply, **Zoom In / Zoom Out / Fit** buttons work, and **ArrowLeft / ArrowRight / Escape** navigate and close (`get_full_res_preview` on Desktop).
- [ ] **C3 (Loaded-Files Popover — Both):** Click the topbar session pill (`N files · M cards`) → confirm the **LOADED FILES** popover lists every source file, clicking the checkmark selects that file's cards, and clicking the trash icon removes only that file.
- [ ] **C4 (Grid / List View & Clear — Both):** Toggle Grid/List view buttons, then click **Clear** → confirm workspace returns to empty drop hero.

### D. Tool 1 — PDF / Files → Images (`To image`) — *Tagged: `3a98555`, `717bb13`*
- [ ] **D1 (Web):** Load a 2-page PDF → select **To image** → test **JPG**, **PNG**, **WEBP**, **BMP**, and **TIFF** at `150 DPI` and `300 DPI` → click **Export N images** → confirm ZIP/image downloads and opens cleanly.
- [ ] **D2 (Desktop):** Load a 2-page PDF → select **To image** → export **JPG** and **PNG** at `300 DPI` → confirm files save cleanly into chosen folder without overwriting existing files (`_converted_01` safe naming) and clicking **Open folder** on the success toast opens Explorer.
  > **Pre-existing `main` note (not caused by this branch):** Automated regression testing revealed that Desktop `PdfEngine.pdf_to_images` calls PyMuPDF `pix.save()` (`core/pdf_engine.py:140`), which only accepts `JPG`/`PNG` (not `WEBP`/`BMP`/`TIFF`). Web `To image` and Desktop `Batch` (images-only via Pillow) support all 5 formats. Left untouched per "do not change functionality".

### E. Tool 2 — Files → PDF (`To PDF`) — *Tagged: `3a98555`, `717bb13`*
- [ ] **E1 (Single Combined PDF — Both):** Load 2 images + 1 PDF → select **To PDF** → **Single Combined PDF** → click **Convert N items to PDF** → open output PDF and confirm pages match canvas order.
- [ ] **E2 (Separate PDFs — Both):** Switch to **Separate PDFs** → click **Export N separate PDFs** → confirm Web downloads `deskconvert_N_pdfs.zip` and Desktop saves `N` separate `.pdf` files into the chosen folder.

### F. Tool 3 — Merge & Reorder (`Merge`) — *Tagged: `3a98555`, `717bb13`*
- [ ] **F1 (Both):** Load 2 PDFs + 1 image, reorder cards, check 2 cards (or leave all unchecked), click **Merge N pages** → open saved PDF and verify page count and exact reordered sequence.

### G. Tool 4 — Split & Extract (`Split`) — *Tagged: `3a98555`, `717bb13`*
- [ ] **G1 (Single PDF Mode — Both):** Load a 4-page PDF → select **Split** → **Single PDF** → add ranges `1–2` and `4–4` → click **Export split PDF** → confirm output has 3 pages.
- [ ] **G2 (Individual Files + Quick Helpers — Both):** Click **Every 2p** (or check 2 cards and click **Use Selected (2)**) → switch to **Individual files** → export → confirm Web downloads `_split_pages.zip` and Desktop saves separate page PDFs.

### H. Tool 5 — Universal Batch (`Batch`) — *Tagged: `3a98555`, `717bb13`*
- [ ] **H1 (Images-Only — Both):** Load 2 PNG/JPG images → select **Batch** → test converting to **WEBP**, **BMP**, and **TIFF** → confirm outputs open cleanly.
- [ ] **H2 (Mixed PDF + Image — Both):** Load 1 PDF + 1 PNG → select **Batch** → format **PNG** → confirm both PDF pages and image export together in one pass.

### I. Tool 6 — Smart Compression — *Tagged: `3a98555`, `717bb13`*
- [ ] **I1 (Image Compression — Both):** Load a >200 KB JPG/PNG → toggle **Smart compression** ON → set target to ~50% of original size → click **Compress & Save** → verify downloaded/saved file is near or below target size.
- [ ] **I2 (PDF Compression — Both):** Load an image-heavy PDF → toggle **Smart compression** ON → set target to ~50% of original size → click **Compress & Save** → confirm output PDF shrinks cleanly and opens without corruption.

### J. Tool 7 — OCR Studio (`OCR`) — *Tagged: `825f673`, `3a98555`, `717bb13`*
- [ ] **J1 (Web OCR — CSP Check):** Open DevTools Console → load a scanned image or PDF with clear text → select **OCR** → run **Plain Text (.txt)** and **Searchable PDF** → verify recognized text is accurate AND check DevTools Console for zero `[Report Only]` CSP violations against `cdn.jsdelivr.net`, `blob:`, or `wasm-unsafe-eval`.
- [ ] **J2 (Desktop OCR):** Load a scanned PDF/image → run **OCR → Plain Text (.txt)** and **Searchable PDF** → confirm offline Tesseract runs and outputs save cleanly (no watermark stamped on OCR output).

### K. Watermark, Metadata & Settings Modal — *Tagged: `825f673`, `3a98555`, `747ce32`*
- [ ] **K1 (Both):** Toggle **Watermark** On/Off and **Metadata** Keep/Strip in the right inspector → export a PDF with `Strip` → verify PDF document properties (Author/Title) are blank.
- [ ] **K2 (Desktop Settings):** Click gear icon (**Settings**) → click **Browse** to pick a Default output directory → toggle **Quick Save** ON → click **Save preferences** → restart app → confirm directory and Quick Save persisted cleanly in `%APPDATA%\DeskConvert\settings.json`.

### L. Recent Files History Sidebar — *Tagged: `825f673`, `3a98555`, `747ce32`*
- [ ] **L1 (Collapse / Expand — Both):** Click `×` on the left **Recent files** panel → confirm the entire left column collapses smoothly with no overlap → click the topbar **History** icon to reopen.
- [ ] **L2 (Search, Reopen & Clear — Both):** Type in **Search recent files** to filter; click a Desktop history entry to reload the file from disk (confirm full path storage still works unchanged); click **Clear history** to empty the list.

### M. Compliance Pages, Direct Routes & External Links — *Tagged: `825f673`, `3a98555`, `747ce32`*
- [ ] **M1 (Footer Links — Both):** Click **Privacy**, **Terms**, and **Licenses** in the left sidebar bottom footer (and in the empty-studio footer) → verify the modal opens, tabs switch smoothly, `muhammad.kamal.hq@gmail.com` appears with exact spelling, and Desktop full-path history storage + self-hosted fonts + jsDelivr Web OCR are disclosed accurately.
- [ ] **M2 (Direct Web URLs — Web):** Navigate directly to `/privacy`, `/terms`, and `/licenses` → confirm the corresponding modal tab opens immediately and closing returns the URL cleanly to `/`.
- [ ] **M3 (Clear All Local Data — Both):** Inside **Privacy Policy**, click **Clear all local data** → confirm toast `Local data cleared` appears, recent history empties, and settings reset to defaults.
- [ ] **M4 (External Download & Repo Links — Both):** Open **Desktop app** modal (Web) and **Licenses** tab (Web & Desktop) → click GitHub links → confirm Web opens in a new tab (`rel="noopener noreferrer"`) and Desktop opens in your default OS browser without navigating the WebView away from the app.

### N. Windows Installer Build & SHA-256 Gate — *Tagged: `cbe18b2`*
- [ ] **N1 (Build Verification):** Run `python desktop/verify_installer_assets.py` → confirm exit code `0` (`OK: Verified SHA-256 checksums for all 144 bundled installer asset(s)`). Run `iscc DeskConvert.iss` (when ready to rebuild) → confirm preprocessor verification passes and produces `installer_output/DeskConvert_Setup.exe`.

---

## 3. Boundary-by-Boundary Risk & Under-2-Minute Quick Test Guide

| # | Boundary Changed (Commit) | What Could Break | How It Would Look to a User | Quick Test (< 2 Minutes) |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **Desktop `DeskConvertJsApi` Facade Isolation** (`desktop/bridge.py`, `3a98555`) | If a frontend call used an unallowlisted method name or a method signature drifted from `DesktopBridgeApi`, `pywebview` wouldn't expose it or would raise `AttributeError`. | Clicking a button in the Desktop app (e.g., Browse, Settings, Export) silently fails or shows an error toast (`pywebview.api.<fn> is not a function`). | Run `python -m pytest -p no:cacheprovider tests/test_regression.py -k test_pywebview_reflection_matches_typescript_bridge_contract` (~1 sec) — verifies 1-to-1 parity with `src/engines/desktopEngine.ts`. |
| 2 | **Desktop Bridge Origin Enforcement** (`_assert_app_origin`, `desktop/bridge.py`, `3a98555`) | If `window.get_current_url()` returned a mismatched scheme/port/hostname (e.g. `localhost` vs `127.0.0.1` or `None` during init), valid bridge calls could throw `PermissionError`. | Every Desktop action shows an error toast: `"Bridge calls are restricted to the DeskConvert application origin."` | Launch `python desktop/main.py` → click **+ Browse Files** and open **Settings** → confirm both work. Also run `pytest tests/test_bridge.py -k origin_enforcement` (~1 sec). |
| 3 | **Desktop Local HTTP Server** (`DeskConvertLocalServer`, `desktop/app.py`, `3a98555`) | Overly strict `Host`/`Origin`/`Sec-Fetch-Site` checks or missing MIME/asset routes could block Vite JS/CSS/font/worker loads on localhost; dropping `/js_api` could break non-WebView2 backends (e.g. legacy MSHTML). | Desktop app opens to a blank black screen or unstyled UI with missing icons/fonts. | Launch `python desktop/main.py` — UI must load fully styled with Manrope/DM Mono. Or run `pytest tests/test_regression.py -k test_local_http_server_serves_real_dist_web` (~1 sec). |
| 4 | **WebView2 Navigation Lock & External URL Allowlist** (`desktop/app.py`, `utils/validators.py`, `3a98555`) | `NavigationStarting` or `before_load` could accidentally cancel local SPA navigation (`#privacy`, `/index.html`), or block a legitimate GitHub release link if URL format changes. | Clicking **Privacy/Terms/Licenses** or **Download** in Desktop does nothing or reloads the home page unexpectedly. | In Desktop app (`python desktop/main.py`), click **Licenses** in footer → click `THIRD_PARTY_NOTICES.md` link → confirm default browser opens GitHub while Desktop app stays put. |
| 5 | **Vercel HTTP Headers & Report-Only CSP** (`vercel.json`, `825f673`, `e847292`) | `Cross-Origin-Opener-Policy: same-origin` or `X-Frame-Options: DENY` breaks iframe embedding (if anyone tried embedding DeskConvert). CSP itself is **Report-Only**, so it cannot break anything yet, though missing directives would log console warnings. | Page fails to render inside an `<iframe>` (intended). In normal tabs, zero breakage; DevTools Console shows `[Report Only]` warnings if any directive is missing. | After deploying preview, open `https://<preview-url>/` with DevTools Console open, load a PDF, preview it, and run **OCR**; confirm zero `[Report Only]` CSP messages. |
| 6 | **Path Validation & Filename / Windows Reserved-Name Sanitization** (`utils/validators.py`, `core/export.py`, `desktop/bridge.py`, `3a98555`) | Opening a file located on a network SMB/UNC share (`\\NAS\docs\file.pdf`) or clicking **Open folder** for a directory not exported/configured in the current session is now rejected; filenames with reserved stems (`CON.pdf`) are renamed to `file_CON.pdf`. | Loading a file from `\\server\share` skips it into "Unsupported files skipped"; saving a file named `CON.pdf` outputs `file_CON_converted_01.pdf`; clicking **Open folder** on an unapproved dir shows `"Access denied: requested path is outside allowed output directories."` | Export any PDF on Desktop and click **Open folder** on the toast (must open Explorer). Run `pytest tests/test_bridge.py -k reserved_names` (~1 sec). |
| 7 | **Decompression-Bomb, PDF Page, & Memory Safety Caps** (`utils/validators.py`, `src/engines/adapter.ts`, `webEngine.ts`, `717bb13`) | Unusually huge legitimate files (>250 MB single file or >600 MB total in Web, >500 MB on Desktop, >1,000 pages Web / >2,000 pages Desktop, >179 MP image on Desktop, or huge architectural blueprint PDF rendered at 600 DPI exceeding 64 MP Web / 100 MP Desktop) will be blocked. | User sees a clear red toast explaining the exact cap (e.g., `"File 'huge.pdf' exceeds the 250 MB browser safety limit. Use the Windows Desktop app for larger files."` or `"exceeds the 64 MP browser canvas safety cap... Try a lower DPI"`). | Run `npm run test` (`adapter.test.ts` + `regression.test.ts`, ~2 sec) and `pytest tests/test_core.py -k decompression_bomb` (~1 sec). |
| 8 | **Client `localStorage` Schema Validation** (`src/App.tsx`, `825f673`) | If a future feature adds a new settings field and forgets to add it to `loadWebSettings()`, that field would reset on reload. | Corrupted `localStorage` no longer crashes the app (falls back to safe defaults); valid theme/DPI/watermark/metadata settings persist normally. | In Web DevTools Console, run `localStorage.setItem('deskconvert_v2_settings', '{"theme":123,"customDpi":"bad"}'); location.reload();` → app loads cleanly in dark theme at 300 DPI without crashing. |
| 9 | **Installer Asset SHA-256 Build Gate** (`DeskConvert.iss`, `desktop/verify_installer_assets.py`, `cbe18b2`) | Updating `installer_assets/` (new Poppler or Tesseract version) without regenerating `desktop/installer_checksums.json`, or compiling `DeskConvert.iss` on a machine without `python` on `PATH`, halts `iscc`. | Build-time only (never seen by end users): `iscc` exits with `"Installer asset SHA-256 verification failed"`. | Run `python desktop/verify_installer_assets.py` (~1 sec) → must print `OK: Verified SHA-256 checksums for all 144 bundled installer asset(s).` |

---

## 4. HTTP Security Headers — ENFORCED vs. Report-Only, by File

### File 1: `vercel.json` (Web Studio on Vercel — applies to `/(.*)`)

| Header | Mode | Exact Value |
| :--- | :---: | :--- |
| `Strict-Transport-Security` | **ENFORCED** | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | **ENFORCED** | `nosniff` |
| `X-Frame-Options` | **ENFORCED** | `DENY` |
| `Referrer-Policy` | **ENFORCED** | `no-referrer` |
| `Permissions-Policy` | **ENFORCED** | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` |
| `Cross-Origin-Opener-Policy` | **ENFORCED** | `same-origin` |
| `Content-Security-Policy-Report-Only` | **REPORT-ONLY** | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob: data: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';` |
| `Content-Security-Policy` | *Not set* | Intentionally omitted until Report-Only testing confirms zero violations. |

### File 2: `desktop/app.py` (`DeskConvertLocalServer` — applies to Desktop localhost `http://127.0.0.1:<ephemeral-port>/`)

| Header | Mode | Exact Value |
| :--- | :---: | :--- |
| `Cache-Control` | **ENFORCED** | `no-cache, no-store, must-revalidate` |
| `Pragma` | **ENFORCED** | `no-cache` |
| `Expires` | **ENFORCED** | `0` |
| `X-Content-Type-Options` | **ENFORCED** | `nosniff` |
| `X-Frame-Options` | **ENFORCED** | `DENY` |
| `Referrer-Policy` | **ENFORCED** | `no-referrer` |
| `Cross-Origin-Resource-Policy` | **ENFORCED** | `same-origin` |
| `Access-Control-Allow-Origin` | *Omitted (Removed)* | Previously `*` on `BottleServer`'s `/js_api/<uid>`; route and header completely removed. |
| `Content-Security-Policy*` | *Not set* | Local WebView2 static server enforces origin/method/host/CORP checks; CSP is applied on Vercel. |

### File 3: `index.html`
- **No `<meta http-equiv="Content-Security-Policy">` or security meta tags set.** All Web headers live cleanly in `vercel.json` (and local Desktop headers in `desktop/app.py`).

---

## 5. Every User-Visible Behavior Difference (`main` → `security-compliance-audit`)

1. **Zero Google Fonts Network Calls (`e847292`):** The app no longer contacts `fonts.googleapis.com` or `fonts.gstatic.com`. `Manrope` and `DM Mono` load from bundled `.woff2` files inside `/assets/`, so typography now works completely offline in both Web and Desktop modes.
2. **New Legal & Compliance UI + Shareable Routes (`747ce32`):**
   - Subtle `Privacy · Terms · Licenses` links appear at the bottom of the left **Recent files** sidebar and at the bottom of the empty workspace canvas.
   - Visiting `/privacy`, `/terms`, or `/licenses` on Web (or `#privacy`, `#terms`, `#licenses` on Desktop) opens the corresponding compliance modal tab directly.
   - Inside **Privacy Policy**, users now have a one-click **Clear all local data** button that clears recent history AND resets all saved preferences to defaults (with toast `"Local data cleared"`).
3. **New Safety Limits & Clear Error Messages (`717bb13`):**
   - **Web Studio:** Rejects single files > **250 MB**, total staged session RAM > **600 MB**, PDFs > **1,000 pages**, or rendered canvases > **64 MP** with clear messages recommending the Windows Desktop app or a lower DPI.
   - **Windows Desktop:** Rejects single files > **500 MB**, drag-and-drop base64 payloads > **250 MB** (prompting to use **Browse Files** instead), PDFs > **2,000 pages**, images > **179 MP** (Pillow decompression-bomb guard), or rasterized PDF pages > **100 MP** (recommending a lower DPI).
4. **UNC / Network Paths & Traversal Rejected on Desktop (`3a98555`):**
   - Selecting or passing UNC network paths (`\\server\share\...`) or `..` traversal paths to Desktop staging, settings, or `open_path` is now rejected cleanly instead of being followed.
   - Exported filenames whose stem is a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) are safely prefixed with `file_` (e.g. `CON.png` → `file_CON.png`) instead of failing on Windows device handles.
5. **Desktop `Open folder` & External Link Allowlist (`3a98555`):**
   - `open_path` only opens directories produced during the session or the configured/default output directory (never arbitrary system folders).
   - Clicking external links in Desktop mode routes through the strict allowlist (`https://github.com/kamal-hq/DeskConvert` and subpaths) to open in the user's default browser; all other top-level navigations away from `http://127.0.0.1:<port>` are blocked.
6. **Desktop `save_settings` Accepts Both camelCase & snake_case (`3a98555`):**
   - Previously `SettingsManager.update_from_dict` ignored camelCase keys (`defaultOutputDirectory`, `watermarkEnabled`, etc.) sent from React; `DeskConvertBridge.save_settings` now maps and validates both camelCase and snake_case keys cleanly.
7. **Corrupted `localStorage` Recovery (`825f673`):**
   - Malformed or tampered `localStorage` JSON entries are sanitized/clamped to valid defaults instead of causing runtime UI errors.
8. **README & Repo Compliance Additions (`cbe18b2`, `747ce32`, `f118dc3`):**
   - `README.md` adds a Windows SmartScreen notice and PowerShell/`certutil` SHA-256 verification commands; `THIRD_PARTY_NOTICES.md`, `SECURITY_AUDIT.md`, `.env.example`, and `desktop/verify_installer_assets.py` + `desktop/installer_checksums.json` are added.

---

## 6. Automated Regression Verification Results (Executed on `security-compliance-audit`)

| Suite / Probe | Command | Result | What It Proved |
| :--- | :--- | :---: | :--- |
| **Python Core + Bridge + New Regression Suite** | `python -m pytest -p no:cacheprovider tests/test_core.py tests/test_bridge.py tests/test_regression.py -v` | **15/15 PASSED** | Every `DeskConvertJsApi` method matches TypeScript `DesktopBridgeApi` 1-to-1; realistic multi-PDF/image/folder merge/split/convert/batch/OCR/history flows pass; origin drift, internal attribute reflection, UNC/`..`/outside `open_path`, Windows reserved names, non-allowlisted URLs, raw error leaks, decompression bombs, and all 144 real installer asset SHA-256 hashes pass. |
| **Live TCP Loopback Probe (`DeskConvertLocalServer` → `dist_web/`)** | Started `DeskConvertLocalServer.start_server(['dist_web/index.html'])` and issued live `urllib.request` TCP requests | **PASSED** | `GET /index.html` → `200` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Access-Control-Allow-Origin: None`); `POST /js_api/<uid>` → `405`; foreign `Origin` → `403`; `/../package.json` traversal → `403`. |
| **Frontend Vitest + New Web Regression Suite** | `npm run test` (`src/engines/adapter.test.ts` + `src/engines/regression.test.ts`) | **9/9 PASSED** (2 files) | Exact `vercel.json` ENFORCED vs. Report-Only CSP contract; built `dist_web/` contains Manrope/DM Mono `.woff2` & `pdf.worker` with `0` Google Fonts URLs; real `pdf-lib` merge/split/watermark/metadata-strip round-trip; compliance email spelling, `0` placeholders, and `rel="noopener noreferrer"` + allowlisted GitHub URLs. |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASSED (0 errors)** | Full frontend + new regression test suite typechecks cleanly. |
| **Installer Asset SHA-256 CLI** | `python desktop/verify_installer_assets.py` | **PASSED (144/144)** | Every bundled Tesseract and Poppler binary matches `desktop/installer_checksums.json`. |
