# DeskConvert Project Memory (`memory.md`)

Living log of architectural decisions, bug discoveries, environment constraints, and version milestones.

---

## Key Decisions

### 1. Client-Side WASM on Vercel instead of Server-Side Python Routes
- **Context:** Deploying DeskConvert online via GitHub → Vercel while keeping zero-upload privacy and supporting large PDFs + OCR.
- **Constraint:** Vercel serverless functions impose ~4.5 MB request/response payload caps and execution timeouts, and cannot trivially bundle native Poppler + Tesseract OCR executables.
- **Decision:** Run the Web version 100% in-browser using `pdf-lib`, `pdfjs-dist`, HTML5 Canvas (plus binary BMP and baseline TIFF encoders in `src/engines/webEngine.ts`), `jszip`, and `tesseract.js` WASM. Vercel serves only the static Vite bundle (`dist_web/`). Zero user files leave the device.

### 2. Separate Web Build Directory (`dist_web/`) from PyInstaller (`dist/`)
- **Context:** Vite defaults to `dist/` and PyInstaller also defaults to `dist/`. Putting Vite at the root lets Vercel deploy out of the box, which would conflict with `dist/DeskConvert/`.
- **Decision:** Configure `vite.config.ts` (`build.outDir = "dist_web"`) and `vercel.json` (`outputDirectory = "dist_web"`), keeping PyInstaller in `dist/DeskConvert/` as expected by `DeskConvert.iss`.

### 3. Unified React UI Shared Across Web & Desktop (`pywebview`)
- **Context:** Maintaining two separate UI codebases (React for Vercel + PyQt6 for Windows) doubles work whenever the Figma design evolves.
- **Decision:** Use the Figma-generated React 19 + Tailwind v4 UI (`src/`) as the single frontend for both targets. On desktop, a lightweight `pywebview` (Windows Edge WebView2) wrapper (`desktop/app.py` + `desktop/bridge.py`) serves the local `dist_web/` bundle and routes processing calls via `window.pywebview.api` to Python `core/`.

### 4. Redesigned v2.0 App Icon
- **Context:** The v1.0 `assets/icon.ico` was abandoned per owner request.
- **Decision:** Adopted a dark obsidian (`#0E1114`) rounded squircle tile with warm ivory (`#F1EEE6`) and brushed steel-blue (`#80A9C5 → #496F8E`) angled document cards plus conversion chevron, harmonized with the Figma Studio design system (`assets/icon.ico`, `assets/icon.png`, `public/favicon.png`, `public/favicon.svg`, `public/apple-touch-icon.png`).

---

## v1.0 Audit Findings Resolved in v2.0
1. **History reload bug:** Fixed `ui/main_window.py` and implemented `HistoryManager.get_detailed_entries()` in `utils/history.py`.
2. **Cache leak on exit:** Registered `atexit.register(self.clear_cache)` in `core/cache_manager.py` and hooked window close cleanup in `desktop/app.py` and `ui/main_window.py`.
3. **Range cleanup bug:** Fixed `ui/right_panel.py` (`row["widget"]`) and implemented dynamic multi-range controls in `src/App.tsx`.
4. **Storyboard edits ignored outside Merge:** Added `PdfEngine.build_working_pdf()` so page deletions and drag-and-drop reorderings propagate into `pdf_to_image`, `merge`, `split`, `ocr`, and `compress` on both Web and Desktop.
5. **PDF compression ignored `target_bytes`:** Added adaptive DPI/JPEG page recompression ladders in `core/compression.py` and `src/engines/webEngine.ts` when lossless stream deflation remains above `target_bytes`.
6. **Batch image gaps:** Integrated `ExportEngine.safe_output_path()`, `watermark_enabled`, and `metadata_action` into `core/image_engine.py` and `src/engines/webEngine.ts`.
7. **Core decoupling & legacy cleanup:** Removed `PyQt6` from `core/cache_manager.py`, migrated `utils/settings.py` to portable JSON (`%APPDATA%/DeskConvert/settings.json`), and removed unused v1.0 PyQt6 `ui/`, `workers/`, and empty `assets/icons/` directories.

---

## Verification Milestones
- **Python Automated Suite (`pytest`):** `6 passed` (`tests/test_core.py`, `tests/test_bridge.py`).
- **Web Automated Suite (`vitest`):** `3 passed` (`src/engines/adapter.test.ts`).
- **Web Production Bundle (`npm run build`):** `tsc --noEmit && vite build` → `dist_web/` succeeded cleanly.
