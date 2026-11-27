import { describe, expect, it } from 'vitest';
import {
  WEB_MAX_CANVAS_PIXELS,
  WEB_MAX_FILE_BYTES,
  WEB_MAX_SESSION_BYTES,
  analyzeCompressionTarget,
  expandRangesToZeroBasedIndices,
  formatBytes,
  getFileStem,
  isImageName,
  isPdfName,
  isSupportedFileName,
  normalizePageRanges,
  validateCanvasDimensions,
  validateWebFileLimits,
} from './adapter';

describe('adapter helpers', () => {
  it('validates supported PDF and image filenames', () => {
    expect(isPdfName('report.PDF')).toBe(true);
    expect(isImageName('photo.webp')).toBe(true);
    expect(isSupportedFileName('scan.tiff')).toBe(true);
    expect(isSupportedFileName('malware.exe')).toBe(false);
    expect(getFileStem('C:\\Docs\\final.report.pdf')).toBe('final.report');
  });

  it('normalizes and expands split page ranges accurately', () => {
    const normalized = normalizePageRanges(
      [
        { id: '1', from: 2, to: 4 },
        { id: '2', from: 10, to: 12 }, // out of bounds for 5-page doc
      ],
      5
    );
    expect(normalized).toEqual([
      [2, 4],
      [5, 5],
    ]);
    expect(
      expandRangesToZeroBasedIndices(
        [
          { id: '1', from: 1, to: 2 },
          { id: '2', from: 2, to: 3 },
        ],
        4
      )
    ).toEqual([0, 1, 2]);
  });

  it('enforces 10% minimum reduction rule on compression estimates', () => {
    expect(analyzeCompressionTarget(100_000, 95_000)).toBeNull();
    const est = analyzeCompressionTarget(100_000, 50_000);
    expect(est).not.toBeNull();
    expect(est?.reductionPercent).toBe(50);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('enforces browser file-size, session-size, and canvas-pixel safety caps cleanly', () => {
    // Normal files and high-DPI A4 canvases pass
    expect(() => validateWebFileLimits('report.pdf', 25 * 1024 * 1024, 0)).not.toThrow();
    expect(() => validateCanvasDimensions(4960, 7016, 'A4 @ 600 DPI')).not.toThrow(); // ~34.8 MP

    // Oversized single file rejected clearly
    expect(() =>
      validateWebFileLimits('huge.pdf', WEB_MAX_FILE_BYTES + 1, 0)
    ).toThrow(/browser safety limit/i);

    // Session RAM cap rejected clearly
    expect(() =>
      validateWebFileLimits('batch.pdf', 100 * 1024 * 1024, WEB_MAX_SESSION_BYTES - 10)
    ).toThrow(/session memory cap/i);

    // Decompression bomb canvas rejected clearly
    const bombDim = Math.ceil(Math.sqrt(WEB_MAX_CANVAS_PIXELS)) + 100;
    expect(() => validateCanvasDimensions(bombDim, bombDim, 'Bomb image')).toThrow(
      /canvas safety cap/i
    );
  });
});
