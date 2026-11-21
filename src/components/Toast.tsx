import type { ToastMessage } from '../types';
import { triggerBrowserDownload } from '../engines/webEngine';
import { Icon } from './Icons';

export function ToastStack({
  toasts,
  onDismiss,
  onOpenFolder,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  onOpenFolder?: (path: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className={`toast-card ${t.kind}`} key={t.id}>
          <div className="toast-icon">
            <Icon name={t.kind === 'error' ? 'close' : t.kind === 'success' ? 'check' : 'spark'} size={15} />
          </div>
          <div className="toast-body">
            <b>{t.title}</b>
            {t.detail && <p>{t.detail}</p>}
            <div className="toast-actions">
              {t.artifact?.blob && (
                <button
                  type="button"
                  onClick={() => triggerBrowserDownload(t.artifact!.blob!, t.artifact!.fileName)}
                >
                  <Icon name="download" size={12} /> Download again
                </button>
              )}
              {t.outputDir && onOpenFolder && (
                <button type="button" onClick={() => onOpenFolder(t.outputDir!)}>
                  <Icon name="folder" size={12} /> Open folder
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(t.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
