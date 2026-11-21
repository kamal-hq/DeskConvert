# DeskConvert v2.0 Revamp Roadmap (`phase.md`)

## Phase 1 — Foundation, Docs & Brand Icon
- [x] Audit v1.0 codebase and identify bugs, coupling, and packaging constraints.
- [x] Add `.gitignore` excluding build/installer/cache/node/Vite artifacts.
- [x] Redesign app icon (obsidian/ivory/steel-blue studio squircle), generate multi-resolution `assets/icon.ico`, `assets/icon.png`, and `public/` web favicons.
- [x] Create project documentation (`architecture.md`, `rule.md`, `design.md`, `phase.md`, `memory.md`).

## Phase 2 — Python Core Stabilization & Automated Tests
- [x] Decouple `core/cache_manager.py` from `PyQt6` (return raw image bytes/data URLs; register `atexit` cleanup).
- [x] Refactor `core/pdf_engine.py`: deduplicate image sizing logic, remove unused `img2pdf`, add `build_working_pdf()` for storyboard order/deletions, support page filtering on `pdf_to_images`.
- [x] Fix `core/image_engine.py` (safe output naming, watermark & metadata integration for single and batch conversions).
- [x] Upgrade `core/compression.py` to actually target size on PDFs (lossless deflation first, adaptive image/raster recompression when over target) and support PNG/WebP/JPEG.
- [x] Upgrade `core/ocr_engine.py` to auto-discover bundled Poppler/Tesseract paths (with PyMuPDF raster fallback) and handle image OCR directly.
- [x] Migrate `utils/settings.py` away from `PyQt6.QtCore.QSettings` to portable `%APPDATA%/DeskConvert/settings.json`.
- [x] Build comprehensive `pytest` suite in `tests/test_core.py` and `tests/test_bridge.py` and verify 100% pass rate.

## Phase 3 — Unified Figma Studio UI & Web WASM Engines (Vercel)
- [x] Promote Vite + React 19 + Tailwind v4 scaffold to root (`package.json`, `vite.config.ts` targeting `dist_web/`, `vercel.json`).
- [x] Implement `src/engines/webEngine.ts` using `pdf-lib`, `pdfjs-dist`, Canvas, `jszip`, and `tesseract.js` for 100% client-side execution:
  - PDF ↔ Images (with DPI & format selection)
  - Merge (mixed PDFs & images in storyboard order)
  - Split (multi-range single PDF or individual ZIP)
  - Batch Image Convert (JPG, PNG, WebP, BMP, TIFF)
  - Smart Compression (images & PDFs)
  - Browser OCR (Searchable PDF & Plain Text `.txt`)
  - Watermark & Metadata Keep/Strip
- [x] Build interactive Figma Studio UI (`src/App.tsx` + modular `src/components/`): empty dropzone + quick tools, drag-to-reorder storyboard, undo delete, preview modal with zoom/stepping, settings modal, desktop `.exe` download modal, toast notifications.
- [x] Add Vitest unit tests (`src/engines/adapter.test.ts`) & verify `tsc --noEmit` + `npm run build` (`dist_web/`).

## Phase 4 — Standalone Windows Desktop App & Installer
- [x] Implement `desktop/bridge.py` + `desktop/app.py` (`pywebview` native Edge WebView2 shell loading `dist_web/` and calling upgraded `core/` engines).
- [x] Update `DeskConvert.spec` (bundles `dist_web/`, `core/`, `desktop/`, `utils/`, `assets/icon.ico` without heavy Qt GUI bloat) and `DeskConvert.iss` (v2.0.0 installer bundling Poppler + Tesseract).
- [x] Compile standalone `dist/DeskConvert/DeskConvert.exe` and `installer_output/DeskConvert_Setup.exe`.

## Phase 5 — Final Verification & Release Sync
- [x] Run full `pytest`, `vitest`, TypeScript check, Vite production build (`dist_web/`), and desktop build checks.
- [x] Update `README.md` and `memory.md` with exact verified commands, release instructions for Vercel + GitHub Releases, and final status.
