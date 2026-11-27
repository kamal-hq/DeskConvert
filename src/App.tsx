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
  exportWebSeparatePdfs,
  exportWebSplitPdf,
  getWebSource,
  ingestWebFiles,
  removeWebSource,
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

const ALL_IMAGE_FORMATS: ImageOutputFormat[] = ['JPG', 'PNG', 'WEBP', 'BMP', 'TIFF'];

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
  { mode: 'pdf_to_image', title: 'PDF / Files → Images', desc: 'Export unlimited pages as JPG, PNG, WebP, BMP, or TIFF', icon: 'image' },
  { mode: 'image_to_pdf', title: 'Files → PDF', desc: 'Convert any number of images or PDFs into combined or separate PDFs', icon: 'file' },
  { mode: 'merge', title: 'Merge & Reorder', desc: 'Combine unlimited mixed PDFs and images in visual card order', icon: 'layers' },
  { mode: 'split', title: 'Split & Extract', desc: 'Extract multi-page ranges, selected cards, or fixed N-page chunks', icon: 'scissors' },
  { mode: 'batch_convert', title: 'Universal Batch', desc: 'Bulk-convert entire folders of PDFs & images in one pass', icon: 'grid' },
  { mode: 'ocr', title: 'OCR Studio', desc: 'Turn scanned PDFs & images into searchable PDFs or plain text', icon: 'wand' },
];

function loadWebSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_SETTINGS;
    }
    const dpi = parsed.dpi === 'screen' || parsed.dpi === 'custom' ? parsed.dpi : 'print';
    const customDpiNum = Number(parsed.customDpi);
    return {
      defaultOutputDirectory: typeof parsed.defaultOutputDirectory === 'string' ? parsed.defaultOutputDirectory : '',
      quickSaveEnabled: typeof parsed.quickSaveEnabled === 'boolean' ? parsed.quickSaveEnabled : DEFAULT_SETTINGS.quickSaveEnabled,
      watermarkEnabled: typeof parsed.watermarkEnabled === 'boolean' ? parsed.watermarkEnabled : DEFAULT_SETTINGS.watermarkEnabled,
      metadataAction: parsed.metadataAction === 'strip' ? 'strip' : 'keep',
      dpi,
      customDpi: Number.isFinite(customDpiNum) ? Math.max(72, Math.min(1200, Math.round(customDpiNum))) : DEFAULT_SETTINGS.customDpi,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadWebHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && typeof entry.name === 'string')
      .slice(0, 100)
      .map((entry, idx) => ({
        id: typeof entry.id === 'string' ? entry.id : `h_${idx}`,
        name: String(entry.name).slice(0, 260),
        path: typeof entry.path === 'string' ? entry.path.slice(0, 1024) : undefined,
        kind: entry.kind === 'pdf' ? 'pdf' : 'image',
        pageCount: Number.isFinite(Number(entry.pageCount)) ? Math.max(1, Math.floor(Number(entry.pageCount))) : 1,
        sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Math.max(0, Math.floor(Number(entry.sizeBytes))) : 0,
        timestamp: Number.isFinite(Number(entry.timestamp)) ? Number(entry.timestamp) : Date.now(),
        exists: typeof entry.exists === 'boolean' ? entry.exists : true,
      }));
  } catch {
    return [];
  }
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
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

  const [items, setItems] = useState<StoryboardItem[]>([]);
  const [undoItem, setUndoItem] = useState<{ index: number; item: StoryboardItem } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [dragOverCanvas, setDragOverCanvas] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dropTargetCardId, setDropTargetCardId] = useState<string | null>(null);

  const [toolMode, setToolMode] = useState<ToolMode>('pdf_to_image');
  const [imageFormat, setImageFormat] = useState<ImageOutputFormat>('JPG');
  const [dpiOption, setDpiOption] = useState<string>('300');
  const [pdfExportMode, setPdfExportMode] = useState<'combined' | 'separate'>('combined');
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

  const recordHistoryBatch = useCallback(
    (newEntries: Array<{ fileName: string; kind: 'pdf' | 'image'; pageCount: number; sizeBytes: number; path?: string }>) => {
      if (desktopApi) {
        void desktopApi.get_history().then(setHistory).catch(() => {});
        return;
      }
      setHistory((prev) => {
        const incomingNames = new Set(newEntries.map((e) => e.fileName));
        const filtered = prev.filter((h) => !incomingNames.has(h.name));
        const mapped: HistoryEntry[] = newEntries.map((e, idx) => ({
          id: `${Date.now()}_${idx}_${e.fileName}`,
          name: e.fileName,
          path: e.path,
          kind: e.kind,
          pageCount: e.pageCount,
          sizeBytes: e.sizeBytes,
          timestamp: Date.now(),
          exists: true,
        }));
        const next = [...mapped, ...filtered].slice(0, 100);
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

  const stagedFilesSummary = useMemo(() => {
    const map = new Map<
      string,
      { sourceId: string; fileName: string; kind: 'pdf' | 'image'; cardCount: number; sizeBytes: number }
    >();
    for (const item of items) {
      const existing = map.get(item.sourceId);
      if (existing) {
        existing.cardCount += 1;
      } else {
        map.set(item.sourceId, {
          sourceId: item.sourceId,
          fileName: item.fileName,
          kind: item.kind,
          cardCount: 1,
          sizeBytes: item.sizeBytes,
        });
      }
    }
    return Array.from(map.values());
  }, [items]);

  const totalUniqueFiles = stagedFilesSummary.length;
  const hasPdf = useMemo(() => items.some((i) => i.kind === 'pdf'), [items]);
  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items]);
  const activeTargets = selectedItems.length > 0 ? selectedItems : items;

  const totalEstimatedInputBytes = useMemo(
    () => stagedFilesSummary.reduce((acc, f) => acc + f.sizeBytes, 0),
    [stagedFilesSummary]
  );

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
    } else {
      setToolMode('image_to_pdf');
    }
  }, []);

  const ingestDesktopPaths = useCallback(
    async (paths: string[]) => {
      if (!desktopApi || paths.length === 0) return;
      try {
        setProcessing(true);
        setProgressPct(25);
        setProgressLabel('Staging files locally…');
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
        setProgressLabel(`Loading ${files.length} file${files.length === 1 ? '' : 's'} locally…`);

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
          // Record every newly loaded unique source in local history
          const seenSrc = new Set<string>();
          const histEntries: Array<{ fileName: string; kind: 'pdf' | 'image'; pageCount: number; sizeBytes: number }> = [];
          for (const it of res.items) {
            if (!seenSrc.has(it.sourceId)) {
              seenSrc.add(it.sourceId);
              const src = getWebSource(it.sourceId);
              histEntries.push({
                fileName: it.fileName,
                kind: it.kind,
                pageCount: src?.pageCount ?? 1,
                sizeBytes: src?.sizeBytes ?? it.sizeBytes,
              });
            }
          }
          recordHistoryBatch(histEntries);
        }
      } catch (err) {
        pushToast('error', 'Failed to read file', err instanceof Error ? err.message : String(err));
      } finally {
        setProcessing(false);
        setProgressPct(0);
        setProgressLabel('');
      }
    },
    [applySmartToolSelection, desktopApi, pushToast, recordHistoryBatch]
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

  const removeSourceFile = (sourceId: string) => {
    setItems((prev) => prev.filter((i) => i.sourceId !== sourceId));
    removeWebSource(sourceId);
  };

  const selectSourceFilePages = (sourceId: string) => {
    setItems((prev) => prev.map((i) => (i.sourceId === sourceId ? { ...i, selected: true } : i)));
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

  const applySelectedCardsToSplitRanges = () => {
    const selectedIndices = items
      .map((item, idx) => (item.selected ? idx + 1 : -1))
      .filter((n) => n > 0);
    if (selectedIndices.length === 0) {
      pushToast('info', 'No cards checked', 'Check one or more page cards on the canvas first.');
      return;
    }
    const ranges: PageRange[] = [];
    let start = selectedIndices[0];
    let prev = selectedIndices[0];
    for (let i = 1; i < selectedIndices.length; i++) {
      const curr = selectedIndices[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        ranges.push({ id: `sel_${start}_${prev}`, from: start, to: prev });
        start = curr;
        prev = curr;
      }
    }
    ranges.push({ id: `sel_${start}_${prev}`, from: start, to: prev });
    setSplitRanges(ranges);
  };

  const applyChunkSplitRanges = (chunkSize: number) => {
    const total = Math.max(1, items.length);
    const step = Math.max(1, chunkSize);
    const ranges: PageRange[] = [];
    for (let start = 1; start <= total; start += step) {
      const end = Math.min(total, start + step - 1);
      ranges.push({ id: `chunk_${start}_${end}`, from: start, to: end });
    }
    setSplitRanges(ranges);
    if (ranges.length > 1) {
      setSplitMode('individual');
    }
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
        const payloadItems = activeTargets.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex }));
        let result = null;
        if (toolMode === 'pdf_to_image') {
          result = await desktopApi.export_pdf_to_images({
            items: payloadItems,
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
            separateFiles: pdfExportMode === 'separate',
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
            items: items.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex })),
            ranges: splitRanges,
            mode: splitMode,
            watermarkEnabled: settings.watermarkEnabled,
            metadataAction: settings.metadataAction,
          });
        } else if (toolMode === 'batch_convert') {
          result = await desktopApi.batch_convert_images({
            items: payloadItems,
            format: imageFormat,
            dpi: dpiVal,
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

      // Browser WASM execution (supports unlimited files, mixed PDFs & images)
      const onProg = (pct: number, msg: string) => {
        setProgressPct(pct);
        setProgressLabel(msg);
      };

      let out: { fileName: string; blob: Blob; mimeType: string };
      if (toolMode === 'pdf_to_image') {
        out = await exportWebPdfToImages(
          items,
          imageFormat,
          dpiVal,
          settings.watermarkEnabled,
          compressionTarget,
          onProg
        );
      } else if (toolMode === 'image_to_pdf') {
        if (pdfExportMode === 'separate') {
          out = await exportWebSeparatePdfs(
            items,
            settings.watermarkEnabled,
            settings.metadataAction,
            compressionTarget,
            onProg
          );
        } else if (compressionTarget) {
          out = await compressWebTarget(
            activeTargets,
            compressionTarget,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
        } else {
          const pdfBytes = await buildWorkingPdfBytes(
            activeTargets,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
          const stem = getFileStem(activeTargets[0].fileName);
          out = {
            fileName: `${stem}_converted.pdf`,
            blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
          };
        }
      } else if (toolMode === 'merge') {
        if (compressionTarget) {
          out = await compressWebTarget(
            activeTargets,
            compressionTarget,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
        } else {
          const pdfBytes = await buildWorkingPdfBytes(
            activeTargets,
            settings.watermarkEnabled,
            settings.metadataAction,
            onProg
          );
          const stem = getFileStem(activeTargets[0].fileName);
          out = {
            fileName: `${stem}_merged.pdf`,
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
        out = await exportWebBatchImages(
          items,
          imageFormat,
          dpiVal,
          settings.watermarkEnabled,
          compressionTarget,
          onProg
        );
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
    activeTargets,
    compressionEnabled,
    desktopApi,
    dpiOption,
    imageFormat,
    items,
    ocrMode,
    pdfExportMode,
    processing,
    pushToast,
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
        const payloadItems = activeTargets.map((i) => ({ sourceId: i.sourceId, pageIndex: i.pageIndex }));
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
      pushToast('success', 'Compressed output ready', `${out.fileName} (${formatBytes(out.blob.size)})`, {
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
        : `${totalUniqueFiles} files · ${items.length} cards`;

  const exportButtonLabel = useMemo(() => {
    const count = activeTargets.length;
    if (toolMode === 'pdf_to_image') return `Export ${count} image${count === 1 ? '' : 's'}`;
    if (toolMode === 'image_to_pdf') {
      return pdfExportMode === 'separate' && count > 1
        ? `Export ${count} separate PDFs`
        : `Convert ${count} item${count === 1 ? '' : 's'} to PDF`;
    }
    if (toolMode === 'merge') return `Merge ${count} page${count === 1 ? '' : 's'}`;
    if (toolMode === 'split') return splitMode === 'single' ? 'Export split PDF' : 'Export split pages';
    if (toolMode === 'batch_convert') return `Batch convert ${count} item${count === 1 ? '' : 's'}`;
    return ocrMode === 'searchable_pdf' ? `OCR ${count} page${count === 1 ? '' : 's'} → PDF` : `OCR ${count} page${count === 1 ? '' : 's'} → .txt`;
  }, [activeTargets.length, ocrMode, pdfExportMode, splitMode, toolMode]);

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
            onClick={() => setHistoryOpen((v) => !v)}
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

          <div className="session-cluster">
            <button
              type="button"
              className="icon-button"
              aria-label="Toggle recent files panel"
              title={historyOpen ? 'Hide recent files panel' : 'Show recent files panel'}
              style={{
                borderColor: historyOpen ? 'var(--accent)' : undefined,
                color: historyOpen ? 'var(--text)' : undefined,
              }}
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <Icon name="history" size={16} />
            </button>

            <button
              type="button"
              className="session-pill"
              onClick={() => {
                if (items.length === 0) {
                  void handleBrowseClick('files');
                } else {
                  setSessionMenuOpen((v) => !v);
                }
              }}
              title={items.length > 0 ? 'Manage loaded files' : 'Load PDF or image files'}
            >
              <span className={`pdf-dot ${hasPdf ? '' : 'img-dot'}`}>
                {items.length === 0 ? 'NEW' : totalUniqueFiles > 1 ? 'MIX' : hasPdf ? 'PDF' : 'IMG'}
              </span>
              <span>{activeSessionName}</span>
              {items.length > 0 && <small>{formatBytes(totalEstimatedInputBytes)}</small>}
              <Icon name="chevron" size={14} />
            </button>

            {sessionMenuOpen && items.length > 0 && (
              <div className="session-popover">
                <div className="session-popover-head">
                  <span>LOADED FILES ({stagedFilesSummary.length})</span>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label="Close loaded files menu"
                    onClick={() => setSessionMenuOpen(false)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
                {stagedFilesSummary.map((file) => (
                  <div className="session-file-row" key={file.sourceId}>
                    <div>
                      <b>{file.fileName}</b>
                      <small>
                        {file.cardCount} card{file.cardCount === 1 ? '' : 's'} · {formatBytes(file.sizeBytes)}
                      </small>
                    </div>
                    <div className="session-file-actions">
                      <button
                        type="button"
                        className="icon-button small"
                        title="Select pages from this file"
                        onClick={() => selectSourceFilePages(file.sourceId)}
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button small"
                        title="Remove file from session"
                        onClick={() => removeSourceFile(file.sourceId)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    className="soft-button"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => {
                      setSessionMenuOpen(false);
                      void handleBrowseClick('files');
                    }}
                  >
                    <Icon name="plus" size={13} /> Add files
                  </button>
                  <button
                    type="button"
                    className="soft-button"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => {
                      setSessionMenuOpen(false);
                      void handleBrowseClick('folder');
                    }}
                  >
                    <Icon name="folder" size={13} /> Add folder
                  </button>
                </div>
              </div>
            )}
          </div>
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

      <section className={`workspace ${historyOpen ? 'history-open' : 'history-closed'}`}>
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

          <p className="date-label">RECENT SESSIONS ({filteredHistory.length})</p>
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
                      pushToast('info', 'Reopen local file', 'Select or drop the file to load it into the current session.');
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
          onClick={() => {
            if (sessionMenuOpen) setSessionMenuOpen(false);
          }}
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
              <div className="drop-hero">
                <div className="drop-icon-ring">
                  <Icon name="upload" size={24} />
                </div>
                <h1>Drop Unlimited PDFs, Images, or Folders</h1>
                <p>
                  No file-count limits and no single-PDF lockouts—load as many PDFs and images together
                  as your machine can handle. Reorder pages, convert formats, compress, split, and run OCR.
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
                <div>
                  <h1>{activeSessionName}</h1>
                  <span>
                    {items.length} card{items.length === 1 ? '' : 's'} <i>·</i>{' '}
                    {totalUniqueFiles} source file{totalUniqueFiles === 1 ? '' : 's'} <i>·</i>{' '}
                    Drag cards to reorder · All tools unlocked
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
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => void handleBrowseClick('folder')}
                  >
                    <Icon name="folder" size={15} /> Add folder
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
                      setSessionMenuOpen(false);
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
                      <span title={`${item.fileName} (${item.pageLabel})`}>
                        <b>{(idx + 1).toString().padStart(2, '0')}</b>
                        {totalUniqueFiles > 1 && item.kind === 'pdf'
                          ? `${getFileStem(item.fileName)} · P${item.pageIndex + 1}`
                          : item.pageLabel}
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
            {TOOL_ITEMS.map((t) => (
              <button
                type="button"
                key={t.id}
                className={toolMode === t.id ? 'active' : ''}
                onClick={() => setToolMode(t.id)}
              >
                <Icon name={t.icon} size={17} />
                <span>{t.label}</span>
                {t.badge && <small>{t.badge}</small>}
              </button>
            ))}
          </div>

          {(toolMode === 'pdf_to_image' || toolMode === 'batch_convert') && (
            <>
              <div className="form-section">
                <label>
                  Image format <span>All 5 formats</span>
                </label>
                <div
                  className="format-options"
                  style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
                >
                  {ALL_IMAGE_FORMATS.map((fmt) => (
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
            </>
          )}

          {toolMode === 'image_to_pdf' && (
            <div className="form-section">
              <label>
                PDF output mode <span>{activeTargets.length} item{activeTargets.length === 1 ? '' : 's'}</span>
              </label>
              <div className="split-mode-toggle" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className={pdfExportMode === 'combined' ? 'active' : ''}
                  onClick={() => setPdfExportMode('combined')}
                >
                  Single Combined PDF
                </button>
                <button
                  type="button"
                  className={pdfExportMode === 'separate' ? 'active' : ''}
                  onClick={() => setPdfExportMode('separate')}
                >
                  Separate PDFs
                </button>
              </div>
            </div>
          )}

          {toolMode === 'split' && (
            <div className="form-section">
              <label>
                Page ranges <span>{items.length || 1} total</span>
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

              <div className="split-quick-row">
                <button type="button" onClick={applySelectedCardsToSplitRanges}>
                  Use Selected ({selectedItems.length})
                </button>
                <button type="button" onClick={() => applyChunkSplitRanges(1)}>
                  Every 1p
                </button>
                <button type="button" onClick={() => applyChunkSplitRanges(2)}>
                  Every 2p
                </button>
                <button type="button" onClick={() => applyChunkSplitRanges(5)}>
                  Every 5p
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
              <div className="split-mode-toggle" style={{ marginBottom: 0 }}>
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
                  <Icon name="compress" size={14} /> Compress &amp; Save ({activeTargets.length})
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
                {activeTargets.length} of {items.length} card{items.length === 1 ? '' : 's'} ·{' '}
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
