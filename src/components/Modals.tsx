import { useEffect, useState } from 'react';
import type { AppSettings } from '../types';
import { DESKTOP_INSTALLER_URL, DESKTOP_RELEASE_URL } from '../engines/adapter';
import { Icon } from './Icons';

export function PreviewModal({
  title,
  imageUrl,
  pageNumber,
  totalPages,
  onClose,
  onPrev,
  onNext,
}: {
  title: string;
  imageUrl: string;
  pageNumber: number;
  totalPages: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="preview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <Icon name="eye" />
          </div>
          <div>
            <p>
              PAGE {pageNumber} OF {totalPages}
            </p>
            <h2>{title}</h2>
          </div>
          <div className="preview-controls">
            <button
              className="icon-button small"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            >
              <Icon name="zoomOut" size={15} />
            </button>
            <span className="zoom-badge">{Math.round(zoom * 100)}%</span>
            <button
              className="icon-button small"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
            >
              <Icon name="zoomIn" size={15} />
            </button>
            <button className="soft-button compact-btn" onClick={() => setZoom(1)}>
              Fit
            </button>
            <button className="icon-button small" aria-label="Previous page" onClick={onPrev}>
              <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
                <Icon name="chevron" size={15} />
              </span>
            </button>
            <button className="icon-button small" aria-label="Next page" onClick={onNext}>
              <Icon name="chevron" size={15} />
            </button>
            <button className="icon-button small" aria-label="Close preview" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
        <div className="preview-stage">
          <img
            src={imageUrl}
            alt={title}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          />
        </div>
      </section>
    </div>
  );
}

export function SettingsModal({
  settings,
  isDesktop,
  onPickDirectory,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  isDesktop: boolean;
  onPickDirectory?: () => Promise<string | null>;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);

  const handleBrowse = async () => {
    if (!onPickDirectory) return;
    const chosen = await onPickDirectory();
    if (chosen) {
      setDraft((d) => ({ ...d, defaultOutputDirectory: chosen }));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <Icon name="settings" />
          </div>
          <div>
            <p>DESKCONVERT</p>
            <h2>Settings</h2>
          </div>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-block">
          <label>Default output</label>
          {isDesktop && (
            <div className="dir-picker-row">
              <input
                type="text"
                readOnly
                value={draft.defaultOutputDirectory || 'Desktop (default)'}
                aria-label="Default output directory"
              />
              <button type="button" className="soft-button" onClick={handleBrowse}>
                <Icon name="folder" size={14} /> Browse
              </button>
            </div>
          )}
          <button
            type="button"
            className={`radio-card ${draft.quickSaveEnabled ? 'active' : ''}`}
            onClick={() => setDraft((d) => ({ ...d, quickSaveEnabled: true }))}
          >
            <span>
              <Icon name="download" />
              <i>
                <b>{isDesktop ? 'Quick Save' : 'Auto-download'}</b>
                <small>
                  {isDesktop
                    ? 'Save safely with _converted_NN naming without prompting'
                    : 'Download finished files directly to Downloads'}
                </small>
              </i>
            </span>
            {draft.quickSaveEnabled && (
              <em>
                <Icon name="check" size={13} />
              </em>
            )}
          </button>
          <button
            type="button"
            className={`radio-card ${!draft.quickSaveEnabled ? 'active' : ''}`}
            onClick={() => setDraft((d) => ({ ...d, quickSaveEnabled: false }))}
          >
            <span>
              <Icon name="folder" />
              <i>
                <b>{isDesktop ? 'Ask every time' : 'Prompt / Save card'}</b>
                <small>
                  {isDesktop
                    ? 'Choose destination folder or filename per export'
                    : 'Trigger browser save prompt with preview toast'}
                </small>
              </i>
            </span>
            {!draft.quickSaveEnabled && (
              <em>
                <Icon name="check" size={13} />
              </em>
            )}
          </button>
        </div>

        <div className="settings-block">
          <label>Branding &amp; Privacy defaults</label>
          <div className="modal-row" style={{ marginBottom: 12 }}>
            <span>
              <b>Apply DeskConvert watermark</b>
              <small>Subtle footer stamp on exports (excluded from OCR)</small>
            </span>
            <button
              type="button"
              className={`switch ${draft.watermarkEnabled ? 'on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, watermarkEnabled: !d.watermarkEnabled }))}
            >
              <span />
            </button>
          </div>
          <div className="modal-row">
            <span>
              <b>Strip document metadata</b>
              <small>Remove author, creation dates, and camera EXIF data</small>
            </span>
            <button
              type="button"
              className={`switch ${draft.metadataAction === 'strip' ? 'on' : ''}`}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  metadataAction: d.metadataAction === 'strip' ? 'keep' : 'strip',
                }))
              }
            >
              <span />
            </button>
          </div>
        </div>

        <div className="settings-block">
          <label>Default export DPI</label>
          <div className="format-options" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {(
              [
                ['screen', '72 Screen'],
                ['print', '300 Print'],
                ['custom', 'Custom'],
              ] as const
            ).map(([val, label]) => (
              <button
                type="button"
                key={val}
                className={draft.dpi === val ? 'active' : ''}
                onClick={() => setDraft((d) => ({ ...d, dpi: val }))}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.dpi === 'custom' && (
            <div className="dir-picker-row" style={{ marginTop: 10 }}>
              <input
                type="number"
                min={72}
                max={1200}
                value={draft.customDpi}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    customDpi: Math.max(72, Math.min(1200, Number(e.target.value) || 300)),
                  }))
                }
              />
              <span className="zoom-badge">DPI (72–1200)</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="modal-done"
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          Save preferences
        </button>
      </section>
    </div>
  );
}

export function DownloadDesktopModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <Icon name="download" />
          </div>
          <div>
            <p>WINDOWS STANDALONE APP</p>
            <h2>DeskConvert Desktop v2.0</h2>
          </div>
          <button className="icon-button" aria-label="Close download modal" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-block">
          <label>Why use the Windows installer?</label>
          <div className="desktop-compare-list">
            <div>
              <Icon name="check" size={14} />
              <span>
                <b>Native Offline Engines:</b> Bundled PyMuPDF, Poppler, and Tesseract OCR—zero browser RAM caps.
              </span>
            </div>
            <div>
              <Icon name="check" size={14} />
              <span>
                <b>Folder &amp; Batch Speed:</b> Drop entire folders recursively and save directly with Quick Save.
              </span>
            </div>
            <div>
              <Icon name="check" size={14} />
              <span>
                <b>Identical Privacy:</b> 100% offline processing with auto-wiped OS temp staging.
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <a
            href={DESKTOP_INSTALLER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="modal-done"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 0 }}
          >
            <Icon name="download" size={16} />
            Download Windows Installer (.exe)
          </a>
          <a
            href={DESKTOP_RELEASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="soft-button"
            style={{ textDecoration: 'none', justifyContent: 'center', height: 36 }}
          >
            View All GitHub Releases
          </a>
        </div>
      </section>
    </div>
  );
}
