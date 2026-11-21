# DeskConvert

> **Privacy-First Local PDF & Image Studio**  
> Available both **online in your browser (Vercel)** and as a **standalone Windows desktop app**, built and maintained by **Muhammad Kamal**.

---

## Live Web App & Desktop Installer

- **Web App (Zero Uploads):** Runs 100% locally in your browser using WebAssembly (`pdf-lib`, `pdfjs-dist`, HTML5 Canvas, `jszip`, and `tesseract.js`). Your files never leave your device.
- **Windows Desktop App (`DeskConvert_Setup.exe`):** Uses the exact same studio UI wrapped in a native WebView2 shell (`pywebview`) powered by offline Python engines (`PyMuPDF`, `Pillow`, `Tesseract OCR`, `Poppler`) for large batches, recursive folder drops, and Quick Save.

---

## Features

| Feature | Web (Browser WASM) | Windows Desktop App |
| :--- | :--- | :--- |
| **PDF → Image** | JPG, PNG, WebP (72–600 DPI, ZIP export) | JPG, PNG, WebP (72–1200 DPI, safe folder output) |
| **Image → PDF** | DPI-aware lossless PDF layout | DPI-aware PDF via `PyMuPDF` |
| **Merge & Reorder** | Drag-and-drop mixed PDF/image storyboard | Drag-and-drop mixed PDF/image storyboard |
| **Split PDF** | Multi-range Single PDF or Individual ZIP | Multi-range Single PDF or Individual PDFs |
| **Batch Image Convert** | JPG, PNG, WebP, BMP, TIFF | JPG, PNG, WebP, BMP, TIFF |
| **Smart Compression** | Adaptive PDF + image quality targeting | Adaptive PDF + image quality targeting |
| **OCR Studio** | `tesseract.js` Searchable PDF & `.txt` | Native Tesseract + Poppler Searchable PDF & `.txt` |
| **Watermark & Metadata** | Toggleable stamp (OCR excluded) & strip/keep | Toggleable stamp (OCR excluded) & strip/keep |
| **Recent History & Preview** | Local browser history + zoomable modal | Local persistent history + missing-file check |

---

## Project Documentation

- [architecture.md](architecture.md) — Dual-platform Web + Desktop architecture and data flow
- [design.md](design.md) — Figma-derived design tokens, layout, and v2.0 iconography
- [rule.md](rule.md) — Privacy, file-safety, storyboard fidelity, and testing rules
- [phase.md](phase.md) — v2.0 revamp roadmap and milestone checklist
- [memory.md](memory.md) — Engineering decision log and audit history

---

## Local Development

### Web Studio (Vercel Target)

```bash
npm install
npm run dev        # local Vite dev server
npm run test       # Vitest unit tests
npm run build      # Typecheck + production bundle -> dist_web/
```

Vercel deploys directly from the repository root via [vercel.json](vercel.json) (`npm run build` → `dist_web/`).

### Windows Standalone App

```bash
python -m pip install -r requirements.txt
npm run build
python main.py     # launch native WebView2 desktop studio
python -m pytest tests/test_core.py -v
```

### Build Windows Installer (`.exe`)

```bash
npm run build
pyinstaller DeskConvert.spec --noconfirm
iscc DeskConvert.iss
```

Installer output: `installer_output/DeskConvert_Setup.exe`

---

## Author & License

- **Developer**: Muhammad Kamal
- **Repository**: [kamal-hq/DeskConvert](https://github.com/kamal-hq/DeskConvert)
- **License**: MIT
