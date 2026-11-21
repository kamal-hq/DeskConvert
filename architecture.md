# DeskConvert Architecture (v2.0)

DeskConvert v2.0 is a **privacy-first, dual-platform PDF and Image Studio** engineered to run identically as:
1. **Web Application on Vercel** — 100% client-side in-browser execution (`pdf-lib`, `pdfjs-dist`, HTML5 Canvas, `jszip`, `tesseract.js` WASM). Zero server uploads, zero serverless payload limits, and full local privacy.
2. **Standalone Windows Desktop Application** — A native desktop shell (`pywebview` / Edge WebView2) rendering the exact same React/TypeScript UI backed by upgraded Python native engines (`PyMuPDF`, `Pillow`, `Tesseract OCR`, `Poppler`), packaged via PyInstaller and Inno Setup.

---

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                Shared Studio UI (src/ — React 19 + TS + Tailwind v4) │
│  Topbar · History Drawer · Dotted Storyboard Canvas · Inspector      │
│  Preview Modal · Settings Modal · Desktop Installer Download Modal   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                        EngineAdapter Interface
                        (src/engines/adapter.ts)
                                   │
          ┌────────────────────────┴────────────────────────┐
          ▼                                                 ▼
┌────────────────────────────────────┐    ┌────────────────────────────────────┐
│      Web Engine (Browser WASM)     │    │     Desktop Bridge (pywebview)     │
│        src/engines/webEngine.ts    │    │     src/engines/desktopEngine.ts   │
├────────────────────────────────────┤    ├────────────────────────────────────┤
│ • pdf-lib: merge, split, img→pdf,  │    │ • desktop/bridge.py (JS ↔ Python)  │
│   metadata, PDF watermarking       │    │ • core/pdf_engine.py (PyMuPDF)     │
│ • pdfjs-dist: thumbnails, preview, │    │ • core/image_engine.py (Pillow)    │
│   PDF→image (72–600 DPI)           │    │ • core/compression.py (target size)│
│ • Canvas: image convert/compress   │    │ • core/ocr_engine.py (Tesseract +  │
│ • tesseract.js: browser OCR worker │    │   bundled Poppler binaries)        │
│ • jszip: multi-file ZIP downloads  │    │ • core/cache_manager.py (OS temp)  │
│ • localStorage: settings & history │    │ • utils/settings.py (%APPDATA%)    │
└────────────────────────────────────┘    └────────────────────────────────────┘
```

---

## Runtime Targets & Why This Split Exists

| Aspect | Web Target (Vercel) | Desktop Target (Windows Standalone) |
| :--- | :--- | :--- |
| **Hosting / Packaging** | Static Vite bundle (`dist_web/`) hosted on Vercel via GitHub auto-deploy | PyInstaller (`dist/DeskConvert/`) + Inno Setup (`installer_output/DeskConvert_Setup.exe`) |
| **File Privacy** | Files stay inside browser memory; never sent over network | Files staged read-only in OS temp (`tempfile.mkdtemp`), wiped on exit |
| **Why not Vercel Python APIs?** | Vercel serverless functions cap payloads at ~4.5 MB and lack Poppler/Tesseract binaries | Desktop runs native C/C++ binaries (`PyMuPDF`, `Poppler`, `Tesseract`) locally |
| **Large Files & Batching** | Bound by browser RAM; supports single/multi-file ZIP exports | Native filesystem I/O, multi-hundred-MB files, folder recursive drops, Quick Save |
| **Cross-Distribution** | Header CTA links directly to latest GitHub Release `.exe` installer | Header displays active native desktop mode badge |

---

## Directory Layout

```text
DeskConvert/
├── index.html                  # Root Vite HTML entry
├── package.json                # React 19, Vite, Tailwind v4, pdf-lib, pdfjs-dist, tesseract.js, jszip
├── vercel.json                 # Vercel build ("npm run build" -> dist_web/)
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite build config (outputs to dist_web/ to avoid PyInstaller dist/)
├── public/                     # Static web assets & redesigned favicons
├── src/                        # Unified React/TS UI & Browser WASM engines
│   ├── App.tsx                 # Main studio shell & workspace orchestration
│   ├── index.css               # Design tokens & studio styling (dark & light)
│   ├── components/             # Topbar, HistoryPanel, CanvasGrid, Inspector, Modals, Toasts
│   └── engines/                # EngineAdapter interface, webEngine (WASM), desktopEngine (bridge)
├── core/                       # Decoupled Python processing engines (no UI imports)
├── desktop/                    # Native desktop launcher & pywebview JS API bridge
├── utils/                      # Settings (JSON), History (10-item), Validators
├── assets/                     # Redesigned icon.ico, icon.png, icon.svg
├── tests/                      # Automated pytest (Python) & vitest (Web) suites
├── DeskConvert.spec            # PyInstaller build specification
└── DeskConvert.iss             # Inno Setup installer script (bundles Poppler + Tesseract)
```

---

## Data Flow (Storyboard Fidelity)

1. **Ingest:** Dropped/selected files are validated for supported extensions (`.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.tiff`) and encrypted PDF detection.
2. **Stage:** Each page (PDF) or image becomes a discrete `StoryboardItem` (`id`, `sourceId`, `fileName`, `kind`, `pageIndex`, `thumbnailUrl`, `selected`).
3. **Transform:** Deleting or drag-reordering cards updates the ordered `StoryboardItem[]` list (with undo stack).
4. **Execute:** Every export tool (`To image`, `To PDF`, `Merge`, `Split`, `Batch`, `OCR`, `Compress`) operates on the **current ordered storyboard state** (honoring deletions, reorders, and selected page ranges) rather than raw unmodified inputs.
5. **Post-Process & Deliver:** Applies configured Watermark (all outputs except OCR) and Metadata Keep/Strip, then delivers via browser download/ZIP (Web) or safe non-destructive `_converted_NN` file write (Desktop).
