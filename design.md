# DeskConvert Design System (`design.md`)

Visual specification for DeskConvert v2.0, derived from the Figma studio prototype and paired with the redesigned v2.0 app icon.

---

## 1. Brand & Aesthetic Direction
- **Identity:** Precision local studio for PDFs and images — calm, tactile, dark-mode-first with a warm-paper light mode variant.
- **Iconography (v2.0 Redesign):**
  - Replaced legacy v1.0 icon with a dark obsidian squircle (`#0E1114`) containing a subtle metallic slate hairline border (`#242A30`), top specular sheen, and two angled overlapping document cards (warm ivory `#F1EEE6` + brushed steel-blue `#80A9C5 → #496F8E`) joined by a crisp conversion chevron.
  - Stored in `assets/icon.ico` (multi-size 16–256px), `assets/icon.png` (`512×512`), `public/favicon.png`, `public/icon-192.png`, `public/icon-512.png`, and mirrored cleanly as an inline `<BrandMark />` SVG in the topbar.

---

## 2. Color Tokens

| Token | Dark Mode (Default) | Light Mode | Role |
| :--- | :--- | :--- | :--- |
| `--bg` | `#080a0c` | `#e9e6df` | Studio canvas & deep background |
| `--panel` | `#0e1114` | `#f3f0e9` | Topbar, History drawer, Inspector rail |
| `--panel2` | `#13171b` | `#f8f6f1` | Controls, pills, compression card |
| `--lift` | `#181d22` | `#fffdfa` | Hovered / active surfaces |
| `--line` | `#242a30` | `#d5d1c9` | Primary 1px dividers & borders |
| `--line2` | `#303840` | `#c4c4c0` | Elevated modal & hover borders |
| `--text` | `#f1eee7` | `#171b1e` | Primary headings & labels |
| `--soft` | `#aeb6bb` | `#48535a` | Secondary labels |
| `--muted` | `#7d8993` | `#727b80` | Metadata, hints, mono captions |
| `--accent` | `#5f88a8` | `#5f88a8` | Active selection & primary steel-blue CTA |
| `--mint` | `#79aaba` | `#557f9f` | Local privacy glow & safe indicators |
| `--paper` | `#f1eee6` | `#fffdf8` | Document card paper background |

---

## 3. Typography
- **UI Sans:** `Manrope` (`400`, `500`, `600`, `700`) — tight negative tracking on headings (`-0.3px`).
- **Technical Mono:** `DM Mono` (`400`, `500`) — file sizes, DPI presets, page indices, badge labels, reduction percentages.

---

## 4. Layout & Component Architecture

1. **Top Navigation Bar (`64px` desktop / `56px` mobile):**
   - Left: Brand mark + `DeskConvert` + divider + Active Session Pill (file/batch summary & page count).
   - Center: Glowing mint privacy indicator (`100% Local · Files never leave your device`).
   - Right: Theme toggle (`Dark` / `Light`), Settings modal trigger, and `Desktop app v2.0` CTA button (triggers installer modal on web; shows `Desktop Active` badge inside native desktop app).
2. **Workspace Grid (`height: calc(100vh - 64px)`):**
   - **Left History Panel (`224px`, collapsible):** Search input, Today / Yesterday / Earlier grouping, color-coded `PDF` / `IMG` badges, missing-file indicator, Clear History button.
   - **Center Dotted Canvas (`minmax(480px, 1fr)`):**
     - *Empty State:* Dotted studio grid + dashed dropzone (`Drop PDFs, Images, or Folders`), format pills, `Browse Files` / `Browse Folder` buttons, 6 Quick-Tool launch cards, and subtle desktop installer banner.
     - *Loaded State:* Sticky toolbar (`Add files`, Grid/List view toggle, Clear), responsive `page-grid` (3 columns desktop, 2 mobile) with drag-to-reorder cards, selection checkboxes, hover `Preview` & `Delete` actions, and floating bottom `selection-bar` (`N pages selected · Undo delete · Add more · Clear`).
   - **Right Contextual Inspector (`326px`):**
     - Compact tool grid (`To image`, `To PDF`, `Merge`, `Split`, `Batch`, `OCR`).
     - Adaptive tool options: image format pills (`JPG`, `PNG`, `WEBP`, `BMP`, `TIFF`), DPI dropdown (`72`, `150`, `300`, `600`), multi-range split chips + `Single PDF / Individual PDFs` toggle, OCR output mode (`Searchable PDF` / `Text .txt`).
     - Smart Compression card (toggle + target size KB/MB + reduction meter + quality hint).
     - Compact Watermark & Metadata toggles.
     - Sticky gradient `Export` CTA + live progress bar & toast notifications.
3. **Modals & Responsive Breakpoints:**
   - **Full-Res Page Preview Modal:** Zoom (`Fit` / `100%` / `+/-`) + keyboard/button prev/next page stepping.
   - **Settings Modal:** Output preferences (Auto-download vs Save As / Desktop folder + Quick Save), Watermark toggle, Metadata Keep/Strip cards, default DPI.
   - **Desktop Download Modal (Web only):** Direct download link to GitHub Releases `DeskConvert_Setup.exe` + Web vs Desktop capability comparison.
   - **`<= 1100px`:** History panel overlays cleanly; **`<= 760px`:** Inspector transforms into a slide-up bottom sheet triggered by a floating action button.
