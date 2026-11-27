import { useEffect } from 'react';
import { Icon } from './Icons';

export type LegalTab = 'privacy' | 'terms' | 'licenses';

const THIRD_PARTY_NOTICES_URL =
  'https://github.com/kamal-hq/DeskConvert/blob/main/THIRD_PARTY_NOTICES.md';
const REPO_URL = 'https://github.com/kamal-hq/DeskConvert';
const CONTACT_EMAIL = 'muhammad.kamal.hq@gmail.com';
const EFFECTIVE_DATE = 'November 27, 2026';

export function LegalModal({
  activeTab,
  isDesktop,
  onSelectTab,
  onClearAllLocalData,
  onOpenExternal,
  onClose,
}: {
  activeTab: LegalTab;
  isDesktop: boolean;
  onSelectTab: (tab: LegalTab) => void;
  onClearAllLocalData: () => void;
  onOpenExternal?: (url: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    if (onOpenExternal) {
      e.preventDefault();
      onOpenExternal(url);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-icon">
            <Icon name={activeTab === 'privacy' ? 'lock' : 'file'} />
          </div>
          <div>
            <p>DESKCONVERT COMPLIANCE</p>
            <h2 id="legal-modal-title">
              {activeTab === 'privacy'
                ? 'Privacy Policy'
                : activeTab === 'terms'
                  ? 'Terms of Service'
                  : 'Open-Source Licenses & Attribution'}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close legal dialog"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="legal-tabs" role="tablist" aria-label="Compliance documents">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'privacy'}
            className={activeTab === 'privacy' ? 'active' : ''}
            onClick={() => onSelectTab('privacy')}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'terms'}
            className={activeTab === 'terms' ? 'active' : ''}
            onClick={() => onSelectTab('terms')}
          >
            Terms of Service
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'licenses'}
            className={activeTab === 'licenses' ? 'active' : ''}
            onClick={() => onSelectTab('licenses')}
          >
            Licenses
          </button>
        </div>

        <div className="legal-body">
          {activeTab === 'privacy' && (
            <>
              <p className="legal-meta">
                Effective Date: <b>{EFFECTIVE_DATE}</b> · Contact: <b>{CONTACT_EMAIL}</b>
              </p>

              <h3>1. Zero-Upload Local Processing</h3>
              <p>
                DeskConvert processes your PDFs and images <b>100% locally on your device</b>. No
                user accounts, logins, or remote databases exist, and your documents, thumbnails,
                and OCR output are never uploaded to our servers.
              </p>
              <ul>
                <li>
                  <b>Web Studio (desk-convert.vercel.app):</b> Loaded files remain solely in
                  in-memory browser storage during your active session and are discarded when you
                  clear the workspace or close the tab.
                </li>
                <li>
                  <b>Windows Desktop App:</b> Loaded files are temporarily copied into a
                  user-scoped OS temporary directory (<code>%TEMP%\deskconvert_*</code>) so
                  originals are never overwritten, and the temporary folder is automatically deleted
                  when the app closes.
                </li>
              </ul>

              <h3>2. Data Stored Locally on Your Device</h3>
              <p>
                DeskConvert stores only your app preferences (theme, default DPI, watermark and
                metadata settings) and a local recent-files history (up to 100 entries):
              </p>
              <ul>
                <li>
                  <b>Web Studio:</b> Stored exclusively in your browser&apos;s{' '}
                  <code>localStorage</code> (<code>deskconvert_v2_settings</code> and{' '}
                  <code>deskconvert_v2_history</code> — file names, file types, page counts, and
                  file sizes only; never file contents).
                </li>
                <li>
                  <b>Windows Desktop App:</b> Stored in{' '}
                  <code>%APPDATA%\DeskConvert\settings.json</code>. <b>Important disclosure:</b> to
                  let you reopen recent files in one click, the Desktop app currently stores{' '}
                  <b>full local filesystem paths</b> (which include your Windows user profile folder
                  name / username, e.g., <code>C:\Users\&lt;username&gt;\...</code>) inside{' '}
                  <code>settings.json</code>. This file stays strictly on your PC and is never
                  transmitted anywhere.
                </li>
              </ul>

              <h3>3. Third-Party Network Requests &amp; Processors</h3>
              <p>
                UI fonts (<b>Manrope</b> and <b>DM Mono</b>) are <b>self-hosted</b> directly in
                DeskConvert—no external font CDN (such as Google Fonts) is contacted. When using the
                Web Studio, limited network requests occur only for static app delivery and optional
                Web OCR:
              </p>
              <ul>
                <li>
                  <b>Vercel (Static Hosting):</b> Serves the static HTML, JS, CSS, and font files at{' '}
                  <code>desk-convert.vercel.app</code>. Like any web host, Vercel processes standard
                  HTTP request metadata (IP address, User-Agent, request path) under Vercel&apos;s
                  privacy policy.
                </li>
                <li>
                  <b>jsDelivr CDN (Web OCR Only):</b> Only when you run <b>OCR</b> in the Web
                  Studio, <code>tesseract.js</code> downloads its open-source WebAssembly worker and
                  English language model (<code>eng.traineddata.gz</code>) from{' '}
                  <code>cdn.jsdelivr.net</code> and caches them locally in your browser&apos;s
                  IndexedDB. <b>No document content or extracted text is sent to jsDelivr.</b> In
                  the Windows Desktop app, OCR runs completely offline via bundled Tesseract.
                </li>
                <li>
                  <b>GitHub Releases (Optional Outbound Link):</b> Contacted only if you explicitly
                  click a link to view releases or download the Windows installer from{' '}
                  <code>github.com/kamal-hq/DeskConvert</code>.
                </li>
              </ul>

              <h3>4. Cookies &amp; Analytics</h3>
              <p>
                DeskConvert sets <b>no tracking cookies</b> and includes <b>no analytics</b>,
                advertising pixels, telemetry, or cross-site trackers.
              </p>

              <h3>5. Children&apos;s Privacy</h3>
              <p>
                DeskConvert does not create user accounts and does not knowingly collect personal
                information from children under 13 (or the applicable age of digital consent in your
                jurisdiction).
              </p>

              <h3>6. Your Control &amp; Data Deletion</h3>
              <p>
                Because all data resides strictly on your device, you can delete it at any time
                using the button below (or by clearing site data in your browser / deleting{' '}
                <code>%APPDATA%\DeskConvert\settings.json</code> on Windows).
              </p>
              <div className="legal-action-box">
                <div>
                  <b>Delete all local preferences &amp; recent history</b>
                  <small>
                    {isDesktop
                      ? 'Clears recent history and resets settings in %APPDATA%\\DeskConvert\\settings.json.'
                      : 'Clears deskconvert_v2_history and resets deskconvert_v2_settings in localStorage.'}
                  </small>
                </div>
                <button
                  type="button"
                  className="soft-button"
                  onClick={onClearAllLocalData}
                >
                  <Icon name="trash" size={14} /> Clear all local data
                </button>
              </div>

              <h3>7. Contact</h3>
              <p>
                Privacy questions or requests may be sent to <b>Muhammad Kamal</b> at{' '}
                <b>{CONTACT_EMAIL}</b>.
              </p>
              <p className="legal-disclaimer">
                Note: This Privacy Policy is provided for transparency about DeskConvert&apos;s
                actual technical behavior and does not constitute formal legal advice.
              </p>
            </>
          )}

          {activeTab === 'terms' && (
            <>
              <p className="legal-meta">
                Effective Date: <b>{EFFECTIVE_DATE}</b> · Contact: <b>{CONTACT_EMAIL}</b>
              </p>

              <h3>1. Acceptance of Terms</h3>
              <p>
                By accessing the DeskConvert Web Studio or installing and running the DeskConvert
                Windows Desktop application, you agree to these Terms of Service.
              </p>

              <h3>2. Acceptable Use &amp; Your Documents</h3>
              <p>
                DeskConvert is a general-purpose local document and image utility. You are solely
                responsible for the files you load, convert, merge, split, compress, or OCR, and for
                ensuring you have the legal right to process those materials. Do not use DeskConvert
                for unlawful purposes or to violate applicable laws or third-party intellectual
                property rights.
              </p>

              <h3>3. Local Execution &amp; Backups</h3>
              <p>
                All document processing happens on your own hardware. Processing speed and memory
                capacity depend on your browser or computer. Always keep backups of important
                original files before modifying or replacing them.
              </p>

              <h3>4. Open-Source License</h3>
              <p>
                DeskConvert&apos;s own source code is released under the MIT License. Bundled
                third-party components (including WebAssembly libraries, fonts, and desktop native
                engines) remain governed by their respective open-source licenses listed under the{' '}
                <b>Licenses</b> tab and in <code>THIRD_PARTY_NOTICES.md</code>.
              </p>

              <h3>5. Disclaimer of Warranties (&ldquo;As-Is&rdquo;)</h3>
              <p>
                DeskConvert is provided <b>&ldquo;AS IS&rdquo;</b> and{' '}
                <b>&ldquo;AS AVAILABLE&rdquo;</b>, without warranty of any kind, express or implied,
                including but not limited to the warranties of merchantability, fitness for a
                particular purpose, accuracy of OCR output, and non-infringement.
              </p>

              <h3>6. Limitation of Liability</h3>
              <p>
                To the maximum extent permitted by applicable law, in no event shall the author
                (Muhammad Kamal) or contributors be liable for any direct, indirect, incidental,
                special, consequential, or punitive damages, including loss of data, documents, or
                profits, arising out of or in connection with your use of or inability to use
                DeskConvert.
              </p>

              <h3>7. Changes &amp; Contact</h3>
              <p>
                These terms may be updated as DeskConvert evolves. Questions can be directed to{' '}
                <b>{CONTACT_EMAIL}</b>.
              </p>
              <p className="legal-disclaimer">
                Note: These Terms of Service are a standard open-source project template and do not
                constitute formal legal advice.
              </p>
            </>
          )}

          {activeTab === 'licenses' && (
            <>
              <p className="legal-meta">
                DeskConvert v2.0.0 · Source License: <b>MIT</b> · Copyright © 2026 Muhammad Kamal
              </p>

              <h3>DeskConvert Source Code</h3>
              <p>
                Original source code in{' '}
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => handleLinkClick(e, REPO_URL)}
                >
                  github.com/kamal-hq/DeskConvert
                </a>{' '}
                is licensed under the <b>MIT License</b>.
              </p>

              <h3>Web Studio Bundled Libraries</h3>
              <ul>
                <li>
                  <b>React &amp; React DOM</b> (19.3.1) — MIT License
                </li>
                <li>
                  <b>pdf-lib</b> (1.17.1) — MIT License
                </li>
                <li>
                  <b>PDF.js / pdfjs-dist</b> (4.10.38) — Apache License 2.0
                </li>
                <li>
                  <b>JSZip</b> (3.10.2) — MIT License (dual MIT / GPL-3.0-or-later)
                </li>
                <li>
                  <b>Tesseract.js &amp; Tesseract.js-core</b> (5.1.1) + English traineddata — Apache
                  License 2.0
                </li>
                <li>
                  <b>Fontsource Manrope &amp; DM Mono</b> (5.3.0) — SIL Open Font License 1.1
                </li>
              </ul>

              <h3>Windows Desktop Bundled Components</h3>
              <ul>
                <li>
                  <b>PyMuPDF / MuPDF</b> — GNU Affero General Public License v3.0 (AGPL-3.0) or
                  Artifex Commercial License
                </li>
                <li>
                  <b>Poppler</b> (26.09.0) — GNU General Public License v2.0 / v3.0 (GPL)
                </li>
                <li>
                  <b>Tesseract OCR</b> (5.5.3) — Apache License 2.0
                </li>
                <li>
                  <b>Pillow</b> (10.4.0) — HPND License
                </li>
                <li>
                  <b>pywebview</b> (6.2.1) — BSD 3-Clause License; <b>Bottle</b> (0.13.4) — MIT;{' '}
                  <b>pythonnet</b> (3.2.1) — MIT; <b>pdf2image</b> (1.17.0) — MIT;{' '}
                  <b>pytesseract</b> (0.3.13) — Apache-2.0
                </li>
                <li>
                  <b>PyInstaller</b> (6.22.3) — GPL-2.0-or-later with special bootloader exception
                </li>
              </ul>

              <p>
                View the complete component and DLL inventory in{' '}
                <a
                  href={THIRD_PARTY_NOTICES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => handleLinkClick(e, THIRD_PARTY_NOTICES_URL)}
                >
                  THIRD_PARTY_NOTICES.md
                </a>
                . License inquiries: <b>{CONTACT_EMAIL}</b>.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
