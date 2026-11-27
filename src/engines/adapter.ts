import type { CompressionEstimate, PageRange } from '../types';

export const SUPPORTED_PDF_EXT = '.pdf';
export const SUPPORTED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'];
export const SUPPORTED_ALL_EXTS = [SUPPORTED_PDF_EXT, ...SUPPORTED_IMAGE_EXTS];

export const WATERMARK_TEXT = 'DeskConvert | Made by Muhammad Kamal';
export const DESKTOP_RELEASE_URL = 'https://github.com/kamal-hq/DeskConvert/releases/latest';
export const DESKTOP_INSTALLER_URL =
  'https://github.com/kamal-hq/DeskConvert/releases/latest/download/DeskConvert_Setup.exe';

// Generous browser-memory safety caps against decompression bombs & OOM crashes
export const WEB_MAX_FILE_BYTES = 250 * 1024 * 1024; // 250 MB per file in browser mode
export const WEB_MAX_SESSION_BYTES = 600 * 1024 * 1024; // 600 MB total staged in browser RAM
export const WEB_MAX_PDF_PAGES = 1000; // 1,000 pages per PDF in browser mode
export const WEB_MAX_CANVAS_PIXELS = 64_000_000; // 64 MP per rendered canvas

export function validateWebFileLimits(
  fileName: string,
  fileBytes: number,
  currentSessionBytes: number
): void {
  if (fileBytes > WEB_MAX_FILE_BYTES) {
    throw new Error(
      `File "${fileName}" (${formatBytes(fileBytes)}) exceeds the ${formatBytes(WEB_MAX_FILE_BYTES)} browser safety limit. Use the Windows Desktop app for larger files.`
    );
  }
  if (currentSessionBytes + fileBytes > WEB_MAX_SESSION_BYTES) {
    throw new Error(
      `Adding "${fileName}" would exceed the ${formatBytes(WEB_MAX_SESSION_BYTES)} browser session memory cap. Clear older files or use the Windows Desktop app.`
    );
  }
}

export function validateCanvasDimensions(
  width: number,
  height: number,
  contextLabel = 'Image'
): void {
  const safeW = Math.max(0, Math.round(width));
  const safeH = Math.max(0, Math.round(height));
  if (safeW === 0 || safeH === 0) {
    throw new Error(`${contextLabel} has invalid dimensions (${safeW}×${safeH}).`);
  }
  if (safeW * safeH > WEB_MAX_CANVAS_PIXELS) {
    const mp = Math.round(WEB_MAX_CANVAS_PIXELS / 1_000_000);
    throw new Error(
      `${contextLabel} (${safeW}×${safeH} px) exceeds the ${mp} MP browser canvas safety cap to prevent memory exhaustion. Try a lower DPI or use the Windows Desktop app.`
    );
  }
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

export function getFileStem(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename;
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(0, idx) : base;
}

export function isPdfName(filename: string): boolean {
  return getExtension(filename) === SUPPORTED_PDF_EXT;
}

export function isImageName(filename: string): boolean {
  return SUPPORTED_IMAGE_EXTS.includes(getExtension(filename));
}

export function isSupportedFileName(filename: string): boolean {
  return SUPPORTED_ALL_EXTS.includes(getExtension(filename));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function analyzeCompressionTarget(
  currentBytes: number,
  targetBytes: number
): CompressionEstimate | null {
  if (currentBytes <= 0 || targetBytes <= 0 || targetBytes >= currentBytes * 0.905) {
    return null;
  }
  const reductionPercent = Math.round(((currentBytes - targetBytes) / currentBytes) * 100);
  const suggestedQuality = Math.max(10, Math.min(92, 100 - reductionPercent));
  const estimatedBytes = Math.max(1024, Math.round(currentBytes * (suggestedQuality / 100)));
  return {
    currentBytes,
    targetBytes,
    suggestedQuality,
    reductionPercent,
    estimatedBytes,
  };
}

export function normalizePageRanges(ranges: PageRange[], totalPages: number): Array<[number, number]> {
  if (totalPages <= 0) return [];
  const normalized: Array<[number, number]> = [];
  for (const r of ranges) {
    const start = Math.max(1, Math.min(Math.floor(r.from), totalPages));
    const end = Math.max(1, Math.min(Math.floor(r.to), totalPages));
    if (start <= end) {
      normalized.push([start, end]);
    }
  }
  return normalized.length > 0 ? normalized : [[1, totalPages]];
}

export function expandRangesToZeroBasedIndices(
  ranges: PageRange[],
  totalPages: number
): number[] {
  const clamped = normalizePageRanges(ranges, totalPages);
  const result: number[] = [];
  const seen = new Set<number>();
  for (const [start, end] of clamped) {
    for (let p = start; p <= end; p++) {
      const idx = p - 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        result.push(idx);
      }
    }
  }
  return result;
}

export function isDesktopBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { pywebview?: { api?: unknown } }).pywebview?.api);
}
