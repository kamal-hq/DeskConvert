# DeskConvert

> **Privacy-First Local PDF & Image Studio**  
> Available both **online in your browser (Vercel)** and as a **standalone Windows desktop app**, built and maintained by **Muhammad Kamal**.

---

## Live Web App & Desktop Installer

| Platform | Access Link | Details |
| :--- | :--- | :--- |
| **Web Studio (Live)** | **[https://desk-convert.vercel.app/](https://desk-convert.vercel.app/)** | 100% in-browser WASM — zero uploads, instant access |
| **Windows Desktop App** | **[DeskConvert_Setup.exe](https://github.com/kamal-hq/DeskConvert/releases/latest/download/DeskConvert_Setup.exe)** | Windows 10/11 (64-bit) — bundles Poppler & Tesseract OCR |

- **Web App (Zero Uploads):** Runs 100% locally in your browser at **[desk-convert.vercel.app](https://desk-convert.vercel.app/)** using WebAssembly (`pdf-lib`, `pdfjs-dist`, HTML5 Canvas, `jszip`, and `tesseract.js`). Your files never leave your device.
- **Windows Desktop App (`DeskConvert_Setup.exe`):** Uses the exact same studio UI wrapped in a native WebView2 shell (`pywebview`) powered by offline Python engines (`PyMuPDF`, `Pillow`, `Tesseract OCR`, `Poppler`) for large batches, recursive folder drops, and Quick Save.

### Windows SmartScreen & SHA-256 Verification

Because DeskConvert is an independent open-source project distributed without a paid EV code-signing certificate, **Windows Defender SmartScreen** may show a *"Windows protected your PC"* warning when you first launch `DeskConvert_Setup.exe`.

Before clicking **More info → Run anyway**, verify that your download came directly from the official [GitHub Releases](https://github.com/kamal-hq/DeskConvert/releases) page and confirm its SHA-256 checksum matches the hash published in the release notes:

```powershell
# PowerShell
Get-FileHash .\DeskConvert_Setup.exe -Algorithm SHA256

# Or Command Prompt
certutil -hashfile DeskConvert_Setup.exe SHA256
```

Do not run the installer if the computed SHA-256 does not match the official release hash.

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
python -m pip install -r desktop/requirements.txt
npm run build
python desktop/main.py     # launch native WebView2 desktop studio
python -m pytest tests/test_core.py tests/test_bridge.py -v
```

### Build Windows Installer (`.exe`)

```bash
npm run build
python desktop/verify_installer_assets.py   # verifies pinned SHA-256 hashes for Tesseract & Poppler
pyinstaller DeskConvert.spec --noconfirm
iscc DeskConvert.iss                        # also runs verify_installer_assets.py automatically at compile time
```

Installer output: `installer_output/DeskConvert_Setup.exe`

Publish the release SHA-256 hash alongside `DeskConvert_Setup.exe`:

```powershell
Get-FileHash .\installer_output\DeskConvert_Setup.exe -Algorithm SHA256
```

---

## Author & License

- **Developer**: Muhammad Kamal
- **Repository**: [kamal-hq/DeskConvert](https://github.com/kamal-hq/DeskConvert)
- **License**: MIT
