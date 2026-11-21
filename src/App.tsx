import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  ExportArtifact,
  HistoryEntry,
  ImageOutputFormat,
  OcrOutputMode,
  PageRange,
  SplitOutputMode,
  StoryboardItem,
  ToastMessage,
  ToolMode,
} from './types';
import {
  analyzeCompressionTarget,
  formatBytes,
  getFileStem,
} from './engines/adapter';
import { getDesktopApi } from './engines/desktopEngine';
import {
  buildWorkingPdfBytes,
  clearWebSources,
  compressWebTarget,
  exportWebBatchImages,
  exportWebPdfToImages,
  exportWebSplitPdf,
  getWebSource,
  ingestWebFiles,
  renderWebFullResPreview,
  runWebOcr,
  triggerBrowserDownload,
} from './engines/webEngine';
import { BrandMark, Icon, type IconName } from './components/Icons';
import { DownloadDesktopModal, PreviewModal, SettingsModal } from './components/Modals';
import { ToastStack } from './components/Toast';

const SETTINGS_STORAGE_KEY = 'deskconvert_v2_settings';
const HISTORY_STORAGE_KEY = 'deskconvert_v2_history';

const DEFAULT_SETTINGS: AppSettings = {
  defaultOutputDirectory: '',
  quickSaveEnabled: false,
  watermarkEnabled: true,
  metadataAction: 'keep',
  dpi: 'print',
  customDpi: 300,
  theme: 'dark',
};

const TOOL_ITEMS: Array<{ id: ToolMode; label: string; icon: IconName; badge?: string }> = [
  { id: 'pdf_to_image', label: 'To image', icon: 'image' },
  { id: 'image_to_pdf', label: 'To PDF', icon: 'file' },
  { id: 'merge', label: 'Merge', icon: 'layers' },
  { id: 'split', label: 'Split', icon: 'scissors' },
  { id: 'batch_convert', label: 'Batch', icon: 'grid' },
  { id: 'ocr', label: 'OCR', icon: 'wand', badge: 'LOCAL' },
];

const QUICK_TOOL_CARDS: Array<{
  mode: ToolMode;
  title: string;
  desc: string;
  icon: IconName;
}> = [
  { mode: 'pdf_to_image', title: 'PDF → Images', desc: 'Export pages as JPG, PNG, or WebP up to 600 DPI', icon: 'image' },
  { mode: 'image_to_pdf', title: 'Images → PDF', desc: 'DPI-aware lossless PDF layout from photos & scans', icon: 'file' },
  { mode: 'merge', title: 'Merge & Reorder', desc: 'Combine mixed PDFs and images in visual card order', icon: 'layers' },
  { mode: 'split', title: 'Split PDF', desc: 'Extract multi-page ranges as single or separate PDFs', icon: 'scissors' },
  { mode: 'batch_convert', title: 'Batch Convert', desc: 'Convert image folders across JPG, PNG, WebP, BMP, TIFF', icon: 'grid' },
  { mode: 'ocr', title: 'OCR Studio', desc: 'Turn scanned PDFs into searchable PDFs or plain text', icon: 'wand' },
];

function loadWebSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore storage errors
  }
  return DEFAULT_SETTINGS;
}

function loadWebHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = Array.from(dataTransfer.items || []);

  const readEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readAll = async (): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };
      const children = await readAll();
      for (const child of children) {
        await readEntry(child);
      }
    }
  };

  if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) await readEntry(entry);
    }
    if (files.length > 0) return files;
  }

  return Array.from(dataTransfer.files || []);
}

export default function App() {
  const [desktopApi, setDesktopApi] = useState(() => getDesktopApi());
  const isDesktop = desktopApi !== null;

  const [settings, setSettings] = useState<AppSettings>(loadWebSettings);
  const [history, setHistory] = useState<HistoryEntry[]>(loadWebHistory);
  const [historySearch, setHistorySearch] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);

  const [items, setItems] = useState<StoryboardItem[]>([]);
  const [undoItem, setUndoItem] = useState<{ index: number; item: StoryboardItem } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [dragOverCanvas, setDragOverCanvas] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dropTargetCardId, setDropTargetCardId] = useState<string | null>(null);

  const [toolMode, setToolMode] = useState<ToolMode>('pdf_to_image');
  const [imageFormat, setImageFormat] = useState<ImageOutputFormat>('JPG');
  const [dpiOption, setDpiOption] = useState<string>('300');
  const [splitMode, setSplitMode] = useState<SplitOutputMode>('single');
  const [splitRanges, setSplitRanges] = useState<PageRange[]>([{ id: 'r1', from: 1, to: 1 }]);
  const [ocrMode, setOcrMode] = useState<OcrOutputMode>('searchable_pdf');

  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [targetSizeValue, setTargetSizeValue] = useState('500');
  const [targetSizeUnit, setTargetSizeUnit] = useState<'KB' | 'MB'>('KB');

  const [processing, setProcessing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [mobileInspector, setMobileInspector] = useState(false);
  const [previewState, setPreviewState] = useState<{
    index: number;
    title: string;
    imageUrl: string;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback(
    (kind: ToastMessage['kind'], title: string, detail?: string, extra?: Partial<ToastMessage>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, kind, title, detail, ...extra }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6500);
    },
    []
  );

  // Detect pywebview ready event when running in native Windows desktop shell
  useEffect(() => {
    const syncDesktop = async () => {
      const api = getDesktopApi();
      if (!api) return;
      setDesktopApi(api);
      try {
        const [loadedSettings, loadedHistory] = await Promise.all([
          api.get_settings(),
          api.get_history(),
        ]);
        setSettings(loadedSettings);
        setHistory(loadedHistory);
        setDpiOption(
          loadedSettings.dpi === 'screen'
            ? '72'
            : loadedSettings.dpi === 'custom'
              ? String(loadedSettings.customDpi)
              : '300'
        );
      } catch {
        // ignore bridge init error
      }
    };

    if (getDesktopApi()) {
      void syncDesktop();
    } else {
      window.addEventListener('pywebviewready', syncDesktop);
      return () => window.removeEventListener('pywebviewready', syncDesktop);
    }
  }, []);

  const persistSettings = useCallback(
    async (next: AppSettings) => {
      setSettings(next);
      if (desktopApi) {
        try {
          const updated = await desktopApi.save_settings(next);
          setSettings(updated);
        } catch {
          // fallback
        }
      } else {
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
    },
    [desktopApi]
  );

  const recordHistory = useCallback(
    (fileName: string, kind: 'pdf' | 'image', pageCount: number, sizeBytes: number, path?: string) => {
      if (desktopApi) {
        void desktopApi.get_history().then(setHistory).catch(() => {});
        return;
      }
      setHistory((prev) => {
        const filtered = prev.filter((h) => h.name !== fileName);
        const next: HistoryEntry[] = [
          {
            id: `${Date.now()}_${fileName}`,
            name: fileName,
            path,
            kind,
            pageCount,
            sizeBytes,
            timestamp: Date.now(),
            exists: true,
          },
          ...filtered,
        ].slice(0, 10);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [desktopApi]
  );

  const totalUniqueFiles = useMemo(() => new Set(items.map((i) => i.sourceId)).size, [items]);
  const hasPdf = useMemo(() => items.some((i) => i.kind === 'pdf'), [items]);
  const hasImages = useMemo(() => items.some((i) => i.kind === 'image'), [items]);
  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items]);

  const totalEstimatedInputBytes = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    for (const item of items) {
      if (!seen.has(item.sourceId)) {
        seen.add(item.sourceId);
        total += item.sizeBytes;
      }
    }
    return total;
  }, [items]);

  const targetCompressionBytes = useMemo(() => {
    const num = Number.parseFloat(targetSizeValue.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num * (targetSizeUnit === 'MB' ? 1024 * 1024 : 1024));
  }, [targetSizeUnit, targetSizeValue]);

  const compressionEstimate = useMemo(() => {
    if (!compressionEnabled || items.length === 0) return null;
    const baseBytes = totalEstimatedInputBytes || items[0]?.sizeBytes || 0;
    return analyzeCompressionTarget(baseBytes, targetCompressionBytes);
  }, [compressionEnabled, items, targetCompressionBytes, totalEstimatedInputBytes]);

  // Keep split range bounds synced with page count
  useEffect(() => {
    if (items.length > 0) {
      setSplitRanges([{ id: 'r1', from: 1, to: items.length }]);
      const baseBytes = totalEstimatedInputBytes || items[0].sizeBytes;
      if (baseBytes > 0) {
        const defaultTarget = Math.max(1024, Math.round(baseBytes * 0.65));
        if (defaultTarget >= 1024 * 1024) {
          setTargetSizeUnit('MB');
          setTargetSizeValue((defaultTarget / (1024 * 1024)).toFixed(2));
        } else {
          setTargetSizeUnit('KB');
          setTargetSizeValue(String(Math.round(defaultTarget / 1024)));
        }
      }
    }
  }, [items.length, totalEstimatedInputBytes]);

  const applySmartToolSelection = useCallback((loaded: StoryboardItem[]) => {
    const anyPdf = loaded.some((i) => i.kind === 'pdf');
    const uniqueSources = new Set(loaded.map((i) => i.sourceId)).size;
    if (uniqueSources > 1) {
      setToolMode('merge');
    } else if (anyPdf) {
      setToolMode('pdf_to_image');
    } else if (loaded.length > 1) {
      setToolMode('image_to_pdf');
    } else if (loaded.length === 1) {
      setToolMode('image_to_pdf');
    }
  }, []);

  const ingestDesktopPaths = useCallback(
    async (paths: string[]) => {
      if (!desktopApi || paths.length === 0) return;
      try {
        setProcessing(true);
        setProgressPct(25);
        setProgressLabel('Loading files locally…');
        const res = await desktopApi.stage_paths(paths);
        if (res.rejected.length > 0) {
          pushToast('error', 'Unsupported files skipped', res.rejected.join(', '));
        }
        if (res.encrypted.length > 0) {
          pushToast('error', 'Password-protected PDF skipped', res.encrypted.join(', '));
        }
        if (res.items.length > 0) {
          setItems((prev) => {
            const combined = [...prev, ...res.items];
            if (prev.length === 0) applySmartToolSelection(combined);
            return combined;
          });
          const refreshedHistory = await desktopApi.get_history();
          setHistory(refreshedHistory);
        }
      } catch (err) {
        pushToast('error', 'Failed to load files', err instanceof Error ? err.message : String(err));
      } finally {
        setProcessing(false);
        setProgressPct(0);
        setProgressLabel('');
      }
    },
    [applySmartToolSelection, desktopApi, pushToast]
  );

  const handleBrowserFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      try {
        setProcessing(true);
        setProgressPct(20);
        setProgressLabel('Rendering page previews locally…');

        if (desktopApi) {
          const encoded = await Promise.all(
            files.map(async (f) => {
              const buf = new Uint8Array(await f.arrayBuffer());
              let binary = '';
              const chunk = 0x8000;
              for (let i = 0; i < buf.length; i += chunk) {
                binary += String.fromCharCode(...buf.subarray(i, i + chunk));
              }
              return { name: f.name, base64: btoa(binary) };
            })
          );
          const res = await desktopApi.stage_uploaded_files(encoded);
          if (res.rejected.length > 0) {
            pushToast('error', 'Unsupported files skipped', res.rejected.join(', '));
          }
          if (res.encrypted.length > 0) {
            pushToast('error', 'Password-protected PDF skipped', res.encrypted.join(', '));
          }
          if (res.items.length > 0) {
            setItems((prev) => {
              const combined = [...prev, ...res.items];
              if (prev.length === 0) applySmartToolSelection(combined);
              return combined;
            });
          }
          return;
        }

        const res = await ingestWebFiles(files);
        if (res.rejected.length > 0) {
          pushToast('error', 'Unsupported files skipped', res.rejected.join(', '));
        }
        if (res.encrypted.length > 0) {
          pushToast('error', 'Password-protected PDF skipped', res.encrypted.join(', '));
        }
        if (res.items.length > 0) {
          setItems((prev) => {
            const combined = [...prev, ...res.items];
            if (prev.length === 0) applySmartToolSelection(combined);
            return combined;
          });
          const first = res.items[0];
          const firstSrc = getWebSource(first.sourceId);
          recordHistory(
            first.fileName,
            first.kind,
            firstSrc?.pageCount ?? 1,
            firstSrc?.sizeBytes ?? first.sizeBytes
          );
        }
      } catch (err) {
        pushToast('error', 'Failed to read file', err instanceof Error ? err.message : String(err));
      } finally {
        setProcessing(false);
        setProgressPct(0);
        setProgressLabel('');
      }
    },
    [applySmartToolSelection, desktopApi, pushToast, recordHistory]
  );

  const handleBrowseClick = async (mode: 'files' | 'folder' = 'files') => {
    if (desktopApi) {
      const paths = mode === 'folder' ? await desktopApi.pick_folder() : await desktopApi.pick_files();
      if (paths && paths.length > 0) {
        await ingestDesktopPaths(paths);
      }
      return;
    }
    if (mode === 'folder') {
      folderInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const deleteCard = useCallback((cardId: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === cardId);
      if (idx < 0) return prev;
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      setUndoItem({ index: idx, item: removed });
      return copy;
    });
  }, []);

  const handleUndoDelete = useCallback(() => {
    if (!undoItem) return;
    setItems((prev) => {
      const copy = [...prev];
      const safeIdx = Math.max(0, Math.min(undoItem.index, copy.length));
      copy.splice(safeIdx, 0, undoItem.item);
      return copy;
    });
    setUndoItem(null);
  }, [undoItem]);

  const toggleSelectCard = (cardId: string) => {
    setItems((prev) => prev.map((i) => (i.id === cardId ? { ...i, selected: !i.selected } : i)));
  };

  const openPreviewAt = useCallback(
    async (index: number) => {
      if (index < 0 || index >= items.length) return;
      const item = items[index];
      try {
        const imageUrl = desktopApi
          ? await desktopApi.get_full_res_preview(item.sourceId, item.pageIndex)
          : await renderWebFullResPreview(item);
        setPreviewState({
          index,
          title: `${item.fileName} — ${item.pageLabel}`,
          imageUrl,
        });
      } catch {
        setPreviewState({
          index,
          title: `${item.fileName} — ${item.pageLabel}`,
          imageUrl: item.thumbnailUrl,
        });
      }
    },
    [desktopApi, items]
  );

  const handleDropZone = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCanvas(false);
    if (e.dataTransfer.types.includes('application/x-deskconvert-card')) return;
    const files = await collectDroppedFiles(e.dataTransfer);
    if (files.length > 0) {
      await handleBrowserFiles(files);
    }
  };

  const handleCardDrop = (targetId: string) => {
    if (!draggedCardId || draggedCardId === targetId) {
      setDraggedCardId(null);
      setDropTargetCardId(null);
      return;
    }
    setItems((prev) => {
      const fromIdx = prev.findIndex((i) => i.id === draggedCardId);
      const toIdx = prev.findIndex((i) => i.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
    setDraggedCardId(null);
    setDropTargetCardId(null);
  };

  const handleExecuteExport = useCallback(async () => {
    if (items.length === 0 || processing) return;
    const dpiVal = Math.max(72, Math.min(1200, Number(dpiOption) || 300));
    const compressionTarget = compressionEnabled && targetCompressionBytes > 0 ? targetCompressionBytes : null;

    setProcessing(true);
    setProgressPct(8);
    setProgressLabel('Preparing local export…');

    try {
      if (desktopApi) {
        const payloadItems = items.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex }));
        let result = null;
        if (toolMode === 'pdf_to_image') {
          result = await desktopApi.export_pdf_to_images({
            items: selectedItems.length > 0 ? selectedItems.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex })) : payloadItems,
            format: imageFormat,
            dpi: dpiVal,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
            compressionBytes: compressionTarget,
          });
        } else if (toolMode === 'image_to_pdf') {
          result = await desktopApi.export_images_to_pdf({
            items: payloadItems,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
            compressionBytes: compressionTarget,
          });
        } else if (toolMode === 'merge') {
          result = await desktopApi.merge_files({
            items: payloadItems,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
            compressionBytes: compressionTarget,
          });
        } else if (toolMode === 'split') {
          result = await desktopApi.split_pdf({
            items: payloadItems,
            ranges: splitRanges,
            mode: splitMode,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
          });
        } else if (toolMode === 'batch_convert') {
          result = await desktopApi.batch_convert_images({
            items: payloadItems,
            format: imageFormat,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
            compressionBytes: compressionTarget,
          });
        } else if (toolMode === 'ocr') {
          result = await desktopApi.run_ocr({
            items: payloadItems,
            mode: ocrMode,
          });
        }
        if (result) {
          pushToast('success', 'Export completed', result.summary, {
            outputDir: result.outputDir,
          });
          const refreshed = await desktopApi.get_history();
          setHistory(refreshed);
        }
        return;
      }

      // Browser WASM execution
      const onProg = (pct: number, msg: string) => {
        setProgressPct(pct);
        setProgressLabel(msg);
      };

      let out: { fileName: string; blob: Blob; mimeType: string };
      if (toolMode === 'pdf_to_image') {
        out = await exportWebPdfToImages(items, imageFormat, dpiVal, settings.watermarkEnabled, onProg);
      } else if (toolMode === 'image_to_pdf' || toolMode === 'merge') {
        if (compressionTarget) {
          out = await compressWebTarget(
            items,
            compressionTarget,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
        } else {
          const pdfBytes = await buildWorkingPdfBytes(
            items,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
          const stem = getFileStem(items[0].fileName);
          out = {
            fileName: `${stem}_${toolMode === 'merge' ? 'merged' : 'converted'}.pdf`,
            blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
          };
        }
      } else if (toolMode === 'split') {
        out = await exportWebSplitPdf(
          items,
          splitRanges,
          splitMode,
          settings.watermarkEnabled,
          settings.metadataAction,
          onProg
        );
      } else if (toolMode === 'batch_convert') {
        out = await exportWebBatchImages(items, imageFormat, settings.watermarkEnabled, onProg);
      } else {
        out = await runWebOcr(items, ocrMode, onProg);
      }

      triggerBrowserDownload(out.blob, out.fileName);
      const artifact: ExportArtifact = {
        fileName: out.fileName,
        mimeType: out.mimeType,
        blob: out.blob,
        sizeBytes: out.blob.size,
      };
      pushToast('success', 'Export ready', `${out.fileName} (${formatBytes(out.blob.size)})`, {
        artifact,
      });
    } catch (err) {
      pushToast('error', 'Export failed', err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      setProgressPct(0);
      setProgressLabel('');
    }
  }, [
    compressionEnabled,
    desktopApi,
    dpiOption,
    imageFormat,
    items,
    ocrMode,
    processing,
    pushToast,
    selectedItems,
    settings.metadataAction,
    settings.watermarkEnabled,
    splitMode,
    splitRanges,
    targetCompressionBytes,
    toolMode,
  ]);

  const handleDirectCompress = async () => {
    if (items.length === 0 || processing || targetCompressionBytes <= 0) return;
    setProcessing(true);
    setProgressPct(15);
    setProgressLabel('Compressing locally…');
    try {
      if (desktopApi) {
        const payloadItems = items.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex }));
        const res = hasPdf
          ? await desktopApi.merge_files({
              items: payloadItems,
              watermarkEnabled: settings.watermarkEnabled,
              metadataAction: settings.metadataAction,
              compressionBytes: targetCompressionBytes,
            })
          : await desktopApi.batch_convert_images({
              items: payloadItems,
              format: imageFormat,
              watermarkEnabled: settings.watermarkEnabled,
              metadataAction: settings.metadataAction,
              compressionBytes: targetCompressionBytes,
            });
        if (res) {
          pushToast('success', 'Compression complete', res.summary, { outputDir: res.outputDir });
        }
        return;
      }

      const out = await compressWebTarget(
        items,
        targetCompressionBytes,
        settings.watermarkEnabled,
        settings.metadataAction,
        (p, msg) => {
          setProgressPct(p);
          setProgressLabel(msg);
        }
      );
      triggerBrowserDownload(out.blob, out.fileName);
      pushToast('success', 'Compressed file ready', `${out.fileName} (${formatBytes(out.blob.size)})`, {
        artifact: { fileName: out.fileName, mimeType: out.mimeType, blob: out.blob, sizeBytes: out.blob.size },
      });
    } catch (err) {
      pushToast('error', 'Compression failed', err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      setProgressPct(0);
      setProgressLabel('');
    }
  };

  // Global keyboard shortcuts (Ctrl+Z, Ctrl+S, Delete)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndoDelete();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleExecuteExport();
      } else if (e.key === 'Delete' && selectedItems.length > 0) {
        e.preventDefault();
        deleteCard(selectedItems[0].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteCard, handleExecuteExport, handleUndoDelete, selectedItems]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.name.toLowerCase().includes(q));
  }, [history, historySearch]);

  const activeSessionName =
    items.length === 0
      ? 'No active files'
      : totalUniqueFiles === 1
        ? items[0].fileName
        : `${totalUniqueFiles} files staged`;

  const exportButtonLabel = useMemo(() => {
    const count = selectedItems.length > 0 ? selectedItems.length : items.length;
    if (toolMode === 'pdf_to_image') return `Export ${count} image${count === 1 ? '' : 's'}`;
    if (toolMode === 'image_to_pdf') return 'Convert to PDF';
    if (toolMode === 'merge') return `Merge ${count} page${count === 1 ? '' : 's'}`;
    if (toolMode === 'split') return splitMode === 'single' ? 'Export split PDF' : 'Export split pages';
    if (toolMode === 'batch_convert') return `Convert ${items.filter((i) => i.kind === 'image').length || count} images`;
    return ocrMode === 'searchable_pdf' ? 'Create searchable PDF' : 'Extract text (.txt)';
  }, [items, ocrMode, selectedItems.length, splitMode, toolMode]);

  const isToolAvailable = (mode: ToolMode): boolean => {
    if (items.length === 0) return true;
    if (mode === 'pdf_to_image') return hasPdf;
    if (mode === 'image_to_pdf') return hasImages && !hasPdf;
    if (mode === 'batch_convert') return hasImages;
    if (mode === 'split') return hasPdf || items.length > 1;
    return true;
  };

  return (
    <main className={`app-shell ${settings.theme === 'light' ? 'light' : 'dark'}`}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleBrowserFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleBrowserFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      <header className="topbar">
        <div className="brand-cluster">
          <button
            type="button"
            className="mobile-menu icon-button"
            aria-label="Toggle history drawer"
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <Icon name="menu" />
          </button>
          <a
            className="brand"
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setHistoryOpen((v) => !v);
            }}
          >
            <BrandMark size={28} />
            <strong>DeskConvert</strong>
          </a>
          <span className="divider" />
          <button
            type="button"
            className="session-pill"
            onClick={() => {
              if (items.length === 0) void handleBrowseClick('files');
            }}
            title={items.length > 0 ? `${items.length} storyboard cards loaded` : 'Load PDF or image files'}
          >
            <span className={`pdf-dot ${hasPdf ? '' : 'img-dot'}`}>{items.length === 0 ? 'NEW' : hasPdf ? 'PDF' : 'IMG'}</span>
            <span>{activeSessionName}</span>
            {items.length > 0 && <small>{formatBytes(totalEstimatedInputBytes)}</small>}
            <Icon name="chevron" size={14} />
          </button>
        </div>

        <div className="privacy">
          <span />
          <Icon name="lock" size={13} />
          <b>100% Local</b>
          <em>{isDesktop ? 'Native offline desktop engine' : 'Files never leave your device'}</em>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Toggle dark or light theme"
            onClick={() =>
              void persistSettings({
                ...settings,
                theme: settings.theme === 'dark' ? 'light' : 'dark',
              })
            }
          >
            <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
          {isDesktop ? (
            <span className="desktop-active-pill">
              <Icon name="check" size={13} />
              <span>Desktop App</span>
              <small>v2.0</small>
            </span>
          ) : (
            <button
              type="button"
              className="download-button"
              onClick={() => setDownloadOpen(true)}
            >
              <Icon name="download" size={16} />
              <span>Desktop app</span>
              <small>v2.0</small>
            </button>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className={`history-panel ${historyOpen ? 'open' : 'closed'}`}>
          <div className="panel-heading">
            <div>
              <p>LIBRARY</p>
              <h2>Recent files</h2>
            </div>
            <button
              type="button"
              className="icon-button small"
              aria-label="Close history"
              onClick={() => setHistoryOpen(false)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="history-search">
            <Icon name="search" size={15} />
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search recent files"
            />
          </div>

          <p className="date-label">RECENT SESSIONS</p>
          <div className="history-list">
            {filteredHistory.length === 0 ? (
              <div className="history-empty">
                <Icon name="clock" size={18} />
                <p>Files you open or export appear here locally.</p>
              </div>
            ) : (
              filteredHistory.map((entry) => (
                <button
                  type="button"
                  key={entry.id || entry.path || entry.name}
                  className={`history-item ${entry.exists === false ? 'missing' : ''}`}
                  title={entry.path || entry.name}
                  onClick={() => {
                    if (desktopApi && entry.path) {
                      if (entry.exists === false) {
                        pushToast('error', 'File not found', `${entry.name} may have been moved or deleted.`);
                        return;
                      }
                      void ingestDesktopPaths([entry.path]);
                    } else {
                      pushToast('info', 'Browser security note', 'Drop or browse the local file again to reopen in browser.');
                      void handleBrowseClick('files');
                    }
                  }}
                >
                  <span className={`file-icon ${entry.kind === 'pdf' ? 'pdf' : 'img'}`}>
                    {entry.kind === 'pdf' ? 'PDF' : <Icon name="image" size={15} />}
                  </span>
                  <span>
                    <b>{entry.name}</b>
                    <small>
                      {entry.exists === false
                        ? 'File moved or deleted'
                        : `${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} · ${formatBytes(entry.sizeBytes)}`}
                    </small>
                  </span>
                  {entry.exists === false ? <i>!</i> : <Icon name="chevron" size={14} />}
                </button>
              ))
            )}
          </div>

          <div className="history-bottom">
            <button
              type="button"
              onClick={() => {
                if (desktopApi) void desktopApi.clear_history();
                setHistory([]);
                try {
                  localStorage.removeItem(HISTORY_STORAGE_KEY);
                } catch {
                  // ignore
                }
              }}
            >
              <Icon name="trash" size={15} /> Clear history
            </button>
            <p>
              <Icon name="lock" size={12} /> Stored on this device only
            </p>
          </div>
        </aside>

        <section
          className={`canvas ${dragOverCanvas ? 'drag-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!e.dataTransfer.types.includes('application/x-deskconvert-card')) {
              setDragOverCanvas(true);
            }
          }}
          onDragLeave={() => setDragOverCanvas(false)}
          onDrop={(e) => void handleDropZone(e)}
        >
          {items.length === 0 ? (
            <div className="empty-studio">
              {!historyOpen && (
                <button
                  type="button"
                  className="soft-button floating-history-btn"
                  onClick={() => setHistoryOpen(true)}
                >
                  <Icon name="history" size={15} /> History
                </button>
              )}

              <div className="drop-hero">
                <div className="drop-icon-ring">
                  <Icon name="upload" size={24} />
                </div>
                <h1>Drop PDFs, Images, or Folders</h1>
                <p>
                  Process documents locally with zero uploads. Reorder pages, convert formats,
                  compress to exact KB/MB targets, split ranges, and run OCR.
                </p>
                <div className="format-pills-row">
                  {['PDF', 'JPG', 'PNG', 'WebP', 'BMP', 'TIFF'].map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="export-button hero-primary-btn"
                    onClick={() => void handleBrowseClick('files')}
                  >
                    <Icon name="plus" size={16} /> Browse Files
                  </button>
                  <button
                    type="button"
                    className="soft-button hero-secondary-btn"
                    onClick={() => void handleBrowseClick('folder')}
                  >
                    <Icon name="folder" size={15} /> Browse Folder
                  </button>
                </div>
              </div>

              <div className="quick-tools-grid">
                {QUICK_TOOL_CARDS.map((card) => (
                  <button
                    type="button"
                    key={card.mode}
                    className="quick-tool-card"
                    onClick={() => {
                      setToolMode(card.mode);
                      void handleBrowseClick('files');
                    }}
                  >
                    <span className="quick-tool-icon">
                      <Icon name={card.icon} size={17} />
                    </span>
                    <div>
                      <b>{card.title}</b>
                      <small>{card.desc}</small>
                    </div>
                  </button>
                ))}
              </div>

              {!isDesktop && (
                <div className="desktop-promo-bar">
                  <div>
                    <Icon name="spark" size={15} />
                    <span>
                      Need native multi-GB batch speed &amp; bundled Tesseract + Poppler offline?
                    </span>
                  </div>
                  <button type="button" onClick={() => setDownloadOpen(true)}>
                    Download Windows Installer (.exe)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="canvas-toolbar">
                {!historyOpen && (
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <Icon name="history" size={16} /> History
                  </button>
                )}
                <div>
                  <h1>{activeSessionName}</h1>
                  <span>
                    {items.length} card{items.length === 1 ? '' : 's'} <i>·</i>{' '}
                    {totalUniqueFiles} source file{totalUniqueFiles === 1 ? '' : 's'} <i>·</i>{' '}
                    Drag cards to reorder
                  </span>
                </div>
                <div className="view-actions">
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => void handleBrowseClick('files')}
                  >
                    <Icon name="plus" size={16} /> Add files
                  </button>
                  <div className="view-toggle">
                    <button
                      type="button"
                      className={viewMode === 'grid' ? 'active' : ''}
                      aria-label="Grid view"
                      onClick={() => setViewMode('grid')}
                    >
                      <Icon name="grid" size={16} />
                    </button>
                    <button
                      type="button"
                      className={viewMode === 'list' ? 'active' : ''}
                      aria-label="List view"
                      onClick={() => setViewMode('list')}
                    >
                      <Icon name="menu" size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="soft-button"
                    title="Clear workspace"
                    onClick={() => {
                      setItems([]);
                      setUndoItem(null);
                      clearWebSources();
                    }}
                  >
                    <Icon name="trash" size={14} /> Clear
                  </button>
                </div>
              </div>

              <div className={viewMode === 'grid' ? 'page-grid' : 'page-list'}>
                {items.map((item, idx) => (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedCardId(item.id);
                      e.dataTransfer.setData('application/x-deskconvert-card', item.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      if (draggedCardId && draggedCardId !== item.id) {
                        e.preventDefault();
                        setDropTargetCardId(item.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetCardId === item.id) setDropTargetCardId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCardDrop(item.id);
                    }}
                    onDragEnd={() => {
                      setDraggedCardId(null);
                      setDropTargetCardId(null);
                    }}
                    className={`page-card ${item.selected ? 'selected' : ''} ${
                      dropTargetCardId === item.id ? 'drop-target' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="check-button"
                      aria-label={`Select ${item.pageLabel}`}
                      onClick={() => toggleSelectCard(item.id)}
                    >
                      {item.selected && <Icon name="check" size={13} />}
                    </button>
                    <div className="page-actions">
                      <button
                        type="button"
                        aria-label="Preview full resolution"
                        onClick={() => void openPreviewAt(idx)}
                      >
                        <Icon name="eye" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete page"
                        onClick={() => deleteCard(item.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                    <div className="paper" onClick={() => void openPreviewAt(idx)}>
                      <img src={item.thumbnailUrl} alt={item.pageLabel} loading="lazy" />
                    </div>
                    <div className="page-meta">
                      <span>
                        <b>{(idx + 1).toString().padStart(2, '0')}</b>
                        {item.pageLabel}
                      </span>
                      <span className="kind-mini">{item.kind.toUpperCase()}</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="selection-bar">
                <span className="selection-count">
                  <b>{selectedItems.length}</b> selected
                </span>
                <i />
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => {
                      const allSelected = prev.every((p) => p.selected);
                      return prev.map((p) => ({ ...p, selected: !allSelected }));
                    })
                  }
                >
                  <Icon name="check" size={14} />{' '}
                  {selectedItems.length === items.length ? 'Deselect all' : 'Select all'}
                </button>
                <button type="button" disabled={!undoItem} onClick={handleUndoDelete}>
                  <Icon name="undo" size={14} /> Undo delete
                </button>
                <button type="button" onClick={() => void handleBrowseClick('files')}>
                  <Icon name="plus" size={14} /> Add more
                </button>
                {selectedItems.length > 0 && (
                  <button
                    type="button"
                    className="clear-selection"
                    aria-label="Clear selection"
                    onClick={() => setItems((prev) => prev.map((p) => ({ ...p, selected: false })))}
                  >
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className="mobile-action-button"
                onClick={() => setMobileInspector(true)}
              >
                <Icon name="wand" size={17} /> {exportButtonLabel} <Icon name="chevron" size={16} />
              </button>
            </>
          )}
        </section>

        <aside className={`inspector ${mobileInspector ? 'mobile-open' : ''}`}>
          <div className="mobile-handle" />
          <div className="inspector-title">
            <div>
              <p>EXPORT STUDIO</p>
              <h2>{TOOL_ITEMS.find((t) => t.id === toolMode)?.label ?? 'Export'}</h2>
            </div>
            <button
              type="button"
              className="mobile-close icon-button"
              aria-label="Close inspector"
              onClick={() => setMobileInspector(false)}
            >
              <Icon name="close" size={17} />
            </button>
          </div>

          <div className="tools six-tools">
            {TOOL_ITEMS.map((t) => {
              const enabled = isToolAvailable(t.id);
              return (
                <button
                  type="button"
                  key={t.id}
                  disabled={!enabled}
                  className={toolMode === t.id ? 'active' : ''}
                  onClick={() => setToolMode(t.id)}
                >
                  <Icon name={t.icon} size={17} />
                  <span>{t.label}</span>
                  {t.badge && <small>{t.badge}</small>}
                </button>
              );
            })}
          </div>

          {(toolMode === 'pdf_to_image' || toolMode === 'batch_convert') && (
            <div className="form-section">
              <label>Image format</label>
              <div
                className="format-options"
                style={{
                  gridTemplateColumns:
                    toolMode === 'batch_convert' ? 'repeat(5, 1fr)' : 'repeat(3, 1fr)',
                }}
              >
                {(toolMode === 'batch_convert'
                  ? (['JPG', 'PNG', 'WEBP', 'BMP', 'TIFF'] as ImageOutputFormat[])
                  : (['JPG', 'PNG', 'WEBP'] as ImageOutputFormat[])
                ).map((fmt) => (
                  <button
                    type="button"
                    key={fmt}
                    className={imageFormat === fmt ? 'active' : ''}
                    onClick={() => setImageFormat(fmt)}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {toolMode === 'pdf_to_image' && (
            <div className="form-section">
              <label>
                Resolution <span>{dpiOption === '300' ? 'Best for print' : 'Custom / Web'}</span>
              </label>
              <div className="select-control">
                <div>
                  <b>{dpiOption} DPI</b>
                  <small>
                    {dpiOption === '72'
                      ? 'Fast screen preview'
                      : dpiOption === '300'
                        ? 'High quality · Print ready'
                        : 'Crisp archival render'}
                  </small>
                </div>
                <select value={dpiOption} onChange={(e) => setDpiOption(e.target.value)}>
                  <option value="72">72 DPI (Screen)</option>
                  <option value="150">150 DPI (Balanced)</option>
                  <option value="300">300 DPI (Print)</option>
                  <option value="600">600 DPI (Ultra)</option>
                </select>
                <Icon name="chevron" size={15} />
              </div>
            </div>
          )}

          {toolMode === 'split' && (
            <div className="form-section">
              <label>
                Page ranges <span>{items.length} total</span>
              </label>
              <div className="split-mode-toggle">
                <button
                  type="button"
                  className={splitMode === 'single' ? 'active' : ''}
                  onClick={() => setSplitMode('single')}
                >
                  Single PDF
                </button>
                <button
                  type="button"
                  className={splitMode === 'individual' ? 'active' : ''}
                  onClick={() => setSplitMode('individual')}
                >
                  Individual files
                </button>
              </div>
              <div className="range-list">
                {splitRanges.map((row, idx) => (
                  <div className="range-row" key={row.id}>
                    <span>From</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, items.length)}
                      value={row.from}
                      onChange={(e) =>
                        setSplitRanges((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, from: Number(e.target.value) || 1 } : r))
                        )
                      }
                    />
                    <span>To</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, items.length)}
                      value={row.to}
                      onChange={(e) =>
                        setSplitRanges((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, to: Number(e.target.value) || 1 } : r))
                        )
                      }
                    />
                    {idx > 0 && (
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label="Remove range"
                        onClick={() =>
                          setSplitRanges((prev) => prev.filter((r) => r.id !== row.id))
                        }
                      >
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="soft-button"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                onClick={() =>
                  setSplitRanges((prev) => [
                    ...prev,
                    { id: `r_${Date.now()}`, from: 1, to: Math.max(1, items.length) },
                  ])
                }
              >
                <Icon name="plus" size={14} /> Add page range
              </button>
            </div>
          )}

          {toolMode === 'ocr' && (
            <div className="form-section">
              <label>
                OCR output <span>Watermark excluded</span>
              </label>
              <div className="split-mode-toggle">
                <button
                  type="button"
                  className={ocrMode === 'searchable_pdf' ? 'active' : ''}
                  onClick={() => setOcrMode('searchable_pdf')}
                >
                  Searchable PDF
                </button>
                <button
                  type="button"
                  className={ocrMode === 'text_file' ? 'active' : ''}
                  onClick={() => setOcrMode('text_file')}
                >
                  Plain Text (.txt)
                </button>
              </div>
            </div>
          )}

          <div className="form-section compression-card">
            <div className="section-row">
              <div>
                <label>Smart compression</label>
                <p>Target an exact KB / MB output cap</p>
              </div>
              <button
                type="button"
                className={`switch ${compressionEnabled ? 'on' : ''}`}
                aria-label="Toggle smart compression"
                onClick={() => setCompressionEnabled((v) => !v)}
              >
                <span />
              </button>
            </div>
            {compressionEnabled && (
              <>
                <div className="target-input-row">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={targetSizeValue}
                    onChange={(e) => setTargetSizeValue(e.target.value)}
                    aria-label="Target file size"
                  />
                  <select
                    value={targetSizeUnit}
                    onChange={(e) => setTargetSizeUnit(e.target.value as 'KB' | 'MB')}
                  >
                    <option value="KB">KB</option>
                    <option value="MB">MB</option>
                  </select>
                </div>
                {compressionEstimate ? (
                  <>
                    <div className="size-row">
                      <span>Estimated output</span>
                      <b>
                        {formatBytes(compressionEstimate.estimatedBytes)}{' '}
                        <small>−{compressionEstimate.reductionPercent}%</small>
                      </b>
                    </div>
                    <div className="reduction-bar">
                      <i
                        style={{
                          width: `${Math.max(12, Math.min(95, 100 - compressionEstimate.reductionPercent))}%`,
                        }}
                      />
                    </div>
                    <div className="quality">
                      <Icon name="spark" size={14} />
                      <span>Suggested quality ~{compressionEstimate.suggestedQuality}%</span>
                      <small>{formatBytes(totalEstimatedInputBytes)} now</small>
                    </div>
                  </>
                ) : (
                  <p className="compression-warn">
                    Set target at least 10% smaller than {formatBytes(totalEstimatedInputBytes || 1024)}.
                  </p>
                )}
                <button
                  type="button"
                  className="soft-button"
                  disabled={items.length === 0 || processing || !compressionEstimate}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                  onClick={() => void handleDirectCompress()}
                >
                  <Icon name="compress" size={14} /> Compress &amp; Save directly
                </button>
              </>
            )}
          </div>

          <div className="form-section compact">
            <button
              type="button"
              className="setting-row"
              onClick={() =>
                void persistSettings({
                  ...settings,
                  watermarkEnabled: !settings.watermarkEnabled,
                })
              }
            >
              <span>
                <Icon name="wand" size={16} />
                <b>Watermark</b>
              </span>
              <small className={settings.watermarkEnabled ? 'safe' : ''}>
                {settings.watermarkEnabled ? 'On' : 'Off'}
              </small>
              <Icon name="chevron" size={14} />
            </button>
            <button
              type="button"
              className="setting-row"
              onClick={() =>
                void persistSettings({
                  ...settings,
                  metadataAction: settings.metadataAction === 'keep' ? 'strip' : 'keep',
                })
              }
            >
              <span>
                <Icon name="file" size={16} />
                <b>Metadata</b>
              </span>
              <small className="safe">
                <Icon name="check" size={11} /> {settings.metadataAction === 'strip' ? 'Strip' : 'Keep'}
              </small>
              <Icon name="chevron" size={14} />
            </button>
          </div>

          <div className="export-area">
            <div className="export-summary">
              <span>
                {items.length} card{items.length === 1 ? '' : 's'} ·{' '}
                {toolMode === 'pdf_to_image' || toolMode === 'batch_convert'
                  ? imageFormat
                  : toolMode === 'ocr' && ocrMode === 'text_file'
                    ? 'TXT'
                    : 'PDF'}
              </span>
              <b>{items.length > 0 ? formatBytes(totalEstimatedInputBytes) : 'Ready'}</b>
            </div>
            {processing && (
              <div className="progress-track">
                <div style={{ width: `${Math.max(8, progressPct)}%` }} />
              </div>
            )}
            <button
              type="button"
              disabled={items.length === 0 || processing}
              className={`export-button ${processing ? 'loading' : ''}`}
              onClick={() => void handleExecuteExport()}
            >
              {processing ? (
                <>
                  <span className="spinner" /> {progressLabel || 'Processing locally…'}
                </>
              ) : (
                <>
                  <span>{exportButtonLabel}</span>
                  <Icon name="arrow" size={17} />
                </>
              )}
            </button>
            <p>
              <Icon name="lock" size={11} />{' '}
              {isDesktop ? 'Processed offline on your PC' : 'Processed privately in your browser'}
            </p>
          </div>
        </aside>
      </section>

      {previewState && (
        <PreviewModal
          title={previewState.title}
          imageUrl={previewState.imageUrl}
          pageNumber={previewState.index + 1}
          totalPages={items.length}
          onClose={() => setPreviewState(null)}
          onPrev={() =>
            void openPreviewAt((previewState.index - 1 + items.length) % items.length)
          }
          onNext={() => void openPreviewAt((previewState.index + 1) % items.length)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          isDesktop={isDesktop}
          onPickDirectory={desktopApi ? () => desktopApi.pick_output_directory() : undefined}
          onSave={(next) => {
            void persistSettings(next);
            setDpiOption(
              next.dpi === 'screen' ? '72' : next.dpi === 'custom' ? String(next.customDpi) : '300'
            );
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {downloadOpen && <DownloadDesktopModal onClose={() => setDownloadOpen(false)} />}

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        onOpenFolder={desktopApi ? (p) => void desktopApi.open_path(p) : undefined}
      />
    </main>
  );
}
