# Third-Party Open-Source Notices

DeskConvert's own source code is licensed under the **MIT License** (Copyright © 2026 Muhammad Kamal; see [LICENSE](./LICENSE)).

DeskConvert bundles or depends on the following third-party open-source components across its **Web Studio** (`dist_web/`) and **Windows Desktop Distribution** (`DeskConvert.exe` / `DeskConvert_Setup.exe`).

> **Note:** This document is provided for open-source attribution and compliance transparency and does not constitute legal advice. For licensing compatibility considerations regarding copyleft components bundled in the Windows Desktop distribution (specifically PyMuPDF/MuPDF under AGPL-3.0 and Poppler under GPL), see [SECURITY_AUDIT.md](./SECURITY_AUDIT.md).

---

## 1. Web Studio Runtime Components (`dist_web/`)

| Component | Version | License | Purpose |
| :--- | :--- | :--- | :--- |
| **React** (`react`) | 19.3.1 | MIT | UI component runtime |
| **React DOM** (`react-dom`) | 19.3.1 | MIT | Browser DOM renderer |
| **pdf-lib** (`pdf-lib`) | 1.17.1 | MIT | Client-side PDF creation, merging, splitting, watermarking, metadata |
| **PDF.js** (`pdfjs-dist`) | 4.10.38 | Apache-2.0 | Client-side PDF parsing and canvas rendering |
| **JSZip** (`jszip`) | 3.10.2 | MIT OR GPL-3.0-or-later *(used under MIT)* | Client-side multi-file ZIP packaging |
| **Tesseract.js** (`tesseract.js`) | 5.1.1 | Apache-2.0 | Browser WebAssembly OCR orchestration |
| **Tesseract.js Core** (`tesseract.js-core`, fetched via jsDelivr on Web OCR) | 5.1.1 | Apache-2.0 | WebAssembly build of Tesseract OCR engine |
| **Tesseract.js English Data** (`@tesseract.js-data/eng`, fetched via jsDelivr on Web OCR) | 1.0.0 (`4.0.0_best_int`) | Apache-2.0 | English LSTM OCR traineddata |
| **Fontsource Manrope** (`@fontsource/manrope`) | 5.3.0 | SIL OFL-1.1 | Self-hosted UI sans-serif font (`.woff2`/`.woff`) |
| **Fontsource DM Mono** (`@fontsource/dm-mono`) | 5.3.0 | SIL OFL-1.1 | Self-hosted UI monospace font (`.woff2`/`.woff`) |

### Web Build & Development Tooling (Not Distributed at Runtime)
- **Vite** (`vite` 6.4.6) — MIT
- **@vitejs/plugin-react** (4.7.0) — MIT
- **Tailwind CSS** (`tailwindcss` 4.3.5, `@tailwindcss/vite` 4.3.5) — MIT
- **TypeScript** (`typescript` 5.9.3) — Apache-2.0
- **Vitest** (`vitest` 3.2.7) — MIT

---

## 2. Windows Desktop Distribution Components (`DeskConvert.exe` & `DeskConvert_Setup.exe`)

In addition to embedding the compiled Web Studio frontend (`dist_web/`), the Windows Desktop build packages the following Python libraries, native binaries, and runtimes:

### Python Runtime & Packages
| Component | Pinned / Bundled Version | License | Notes |
| :--- | :--- | :--- | :--- |
| **Python Runtime** | 3.12.10 | PSF License 2.0 | Embedded interpreter via PyInstaller |
| **PyMuPDF & PyMuPDFb (MuPDF)** | `1.24.9` (`desktop/requirements.txt`) / `1.28.2` (local build env) | **GNU AGPL-3.0** (or Artifex Commercial License) | **Strong copyleft.** PDF parsing, rendering, merging, splitting, compression |
| **Pillow (PIL)** | `10.4.0` | HPND *(Historical Permission Notice and Disclaimer)* | Image conversion, EXIF/metadata handling, compression, watermarking |
| **pywebview** | `6.2.1` | BSD-3-Clause | Native Windows WebView2 desktop shell |
| **Bottle** | `0.13.4` | MIT | Localhost static HTTP server used by `pywebview` |
| **proxy-tools** | `0.1.0` | BSD-2-Clause | Dependency of `pywebview` |
| **pythonnet** | `3.2.1` | MIT | .NET CLR bridge for WebView2 WinForms integration |
| **clr-loader** | `0.2.x` | MIT | .NET runtime loader for `pythonnet` |
| **pdf2image** | `1.17.0` | MIT | Python wrapper invoking Poppler `pdftoppm` |
| **pytesseract** | `0.3.13` | Apache-2.0 | Python wrapper invoking Tesseract OCR CLI |
| **PyInstaller** (bootloader) | `6.22.3` | GPL-2.0-or-later **with PyInstaller special exception** | Special exception allows distributing frozen applications under any license |
| **Microsoft WebView2 SDK Assemblies** | Bundled via `pywebview` | Microsoft WebView2 SDK License | Interop DLLs (`Microsoft.Web.WebView2.Core.dll`, `WinForms.dll`) |

### Native Third-Party Binaries Packaged in `DeskConvert_Setup.exe`
| Component | Bundled Version | License | Bundled Path / Delivery |
| :--- | :--- | :--- | :--- |
| **Poppler** (`pdftoppm.exe`, `poppler.dll`, `poppler-cpp.dll`, `poppler-glib.dll`, and CLI tools) | `26.09.0` | **GNU GPL-2.0 / GPL-3.0** | Installed to `{app}\poppler\bin` |
| **Tesseract OCR** (`tesseract-installer.exe`) | `5.5.3.20260724` | Apache-2.0 | Executed silently during setup |
| **Inno Setup 6 Runtime Stub** | `6.7.3` | Inno Setup License *(permissive)* | Self-extracting Windows installer engine |

### Supporting Native Libraries Bundled Inside `installer_assets/poppler/bin/`
The Windows Poppler binary distribution includes its dynamic library dependencies:
- **Cairo** (`cairo.dll`) — LGPL-2.1 / MPL-1.1
- **GLib / GIO / GObject / GModule** (`glib-2.0-0.dll`, `gio-2.0-0.dll`, `gobject-2.0-0.dll`, `gmodule-2.0-0.dll`, `gthread-2.0-0.dll`, `girepository-2.0-0.dll`) — LGPL-2.1-or-later
- **FreeType** (`freetype.dll`) — FreeType License (FTL) / GPL-2.0
- **Fontconfig** (`fontconfig-1.dll`) — MIT-like Fontconfig License
- **HarfBuzz** (`harfbuzz*.dll`) — MIT
- **Graphite2** (`graphite2.dll`) — LGPL-2.1 / MPL-1.1 / GPL-2.0
- **ICU** (`icudt78.dll`, `icuin78.dll`, `icuuc78.dll`, `icuio78.dll`, `icutu78.dll`) — Unicode-3.0 / ICU License
- **Pixman** (`pixman-1-0.dll`) — MIT
- **libjpeg-turbo** (`turbojpeg.dll`, `jpeg8.dll`) — IJG / Modified BSD-3-Clause / zlib
- **libpng** (`libpng16.dll`) — libpng License
- **libtiff** (`libtiff.dll`, `tiff.dll`) — libtiff License
- **OpenJPEG** (`openjp2.dll`) — BSD-2-Clause
- **Little CMS 2** (`lcms2.dll`) — MIT
- **LERC** (`Lerc.dll`) — Apache-2.0
- **OpenSSL 3** (`libcrypto-3-x64.dll`, `libssl-3-x64.dll`) — Apache-2.0
- **libcurl** (`libcurl.dll`) — curl License (MIT-like)
- **libssh2** (`libssh2.dll`) — BSD-3-Clause
- **MIT Kerberos** (`krb5_64.dll`, `gssapi64.dll`, `comerr64.dll`, `k5sprt64.dll`, `krbcc64.dll`, `leashw64.dll`, `xpprof64.dll`, `kfwlogon.dll`) — MIT Kerberos License
- **libpsl** (`psl-5.dll`) — MIT
- **Expat** (`expat.dll`, `libexpat.dll`) — MIT
- **libffi** (`ffi-8.dll`) — MIT
- **GNU libiconv / gettext-runtime** (`iconv.dll`, `charset.dll`, `intl-8.dll`) — LGPL-2.1-or-later
- **PCRE2** (`pcre2-*.dll`) — BSD-3-Clause
- **zlib / libdeflate / bzip2 / xz-lzma / zstd** (`zlib.dll`, `deflate.dll`, `libbz2.dll`, `liblzma.dll`, `libzstd.dll`, `zstd.dll`) — zlib / MIT / bzip2 / 0BSD-public-domain / BSD-3-Clause
- **Microsoft Visual C++ & Universal C Runtime Redistributables** (`vcruntime140*.dll`, `msvcp140*.dll`, `concrt140.dll`, `ucrtbase.dll`, `api-ms-win-*.dll`) — Microsoft Redistributable Runtime License

---

## Contact

For license, attribution, or source-offer inquiries regarding DeskConvert, contact **Muhammad Kamal** at **muhammad.kamal.hq@gmail.com**.
