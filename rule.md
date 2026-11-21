# DeskConvert Engineering Rules & Guardrails

Every change to DeskConvert must obey these non-negotiable architectural, privacy, and quality rules.

---

## 1. Privacy & File Safety
- **Zero External Uploads:** Neither the Web app nor the Desktop app may upload user documents or images to any external server or API.
- **Originals Are Read-Only:** Never modify or overwrite source files in place.
- **OS Temp Staging (Desktop):** Always stage input files into an isolated `tempfile.mkdtemp(prefix="deskconvert_")` directory and guarantee cleanup via both `atexit` and window close handlers.
- **Non-Destructive Output Naming:** All desktop exports must resolve through `ExportEngine.safe_output_path()` / `batch_output_paths()` (`<stem>_converted_01.<ext>`, incrementing cleanly) so existing outputs are never overwritten.

## 2. Storyboard & State Integrity
- **Storyboard Is Source of Truth:** If the user deletes or reorders pages in the canvas, `pdf_to_image`, `merge`, `split`, `ocr`, and `compress` must respect the live storyboard state—never bypass it by reading raw `files[0]` silently.
- **Undo Support:** Page deletions must support single-click / `Ctrl+Z` restoration in exact original position.
- **Watermark Policy:** Watermarking (`DeskConvert | Made by Muhammad Kamal`) applies when enabled to PDF and image exports, and is **always excluded from OCR outputs** (searchable PDFs and `.txt`) so extracted text remains clean.
- **Metadata Policy:** Respect `keep` vs `strip` across both PDFs and images (never silently drop EXIF when `keep` is active, and scrub all EXIF + PDF info dictionary fields when `strip` is active).

## 3. Code Architecture & Boundaries
- **Strict Layer Separation:** `core/` modules must remain 100% independent of any UI toolkit (`PyQt6`, `pywebview`, React). Core functions accept file paths/bytes and return paths/bytes/metadata dictionaries.
- **No Duplicated Logic:** Shared layout math (e.g., DPI-aware PDF page sizing in `core/pdf_engine.py`) and shared export routing must live in a single helper.
- **Single Output-Path Authority:** Workers/engines return the exact final path(s) written; UI notifications and history entries must consume the returned result instead of guessing paths separately.
- **Separate Build Directories:** Vite web builds output to `dist_web/`, while PyInstaller outputs to `dist/DeskConvert/`. Never let web and desktop builds overwrite each other's `dist/` folder.

## 4. Packaging & Distribution
- **Consistent Branding:** Web favicons (`public/`), React `<BrandMark />`, Windows `assets/icon.ico`, and the Inno Setup installer icon must all originate from the unified v2.0 obsidian/ivory/steel-blue studio icon.
- **Self-Contained Windows Installer:** `DeskConvert.iss` must bundle PyInstaller binaries, `installer_assets/poppler/bin`, and `installer_assets/tesseract-installer.exe`, and `core/ocr_engine.py` must resolve bundled Poppler/Tesseract paths automatically even if the user hasn't rebooted for `PATH` updates.

## 5. Quality & Verification Gates
- **Tests Required:** Any change to `core/`, `utils/`, or `src/engines/` must pass automated tests (`pytest` for Python engines, `vitest` + `tsc --noEmit` + `npm run build` for Web).
- **Truthful Feedback:** Never swallow exceptions silently; report missing tools (Poppler/Tesseract), password-protected PDFs, or invalid compression targets (<10% reduction) with clear user-facing alerts.
