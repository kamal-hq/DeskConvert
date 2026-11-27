import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import type {
  ImageOutputFormat,
  MetadataAction,
  OcrOutputMode,
  PageRange,
  SplitOutputMode,
  StoryboardItem,
} from '../types';
import {
  WATERMARK_TEXT,
  WEB_MAX_PDF_PAGES,
  expandRangesToZeroBasedIndices,
  getFileStem,
  isPdfName,
  normalizePageRanges,
  validateCanvasDimensions,
  validateWebFileLimits,
} from './adapter';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export interface LoadedSource {
  sourceId: string;
  fileName: string;
  kind: 'pdf' | 'image';
  bytes: Uint8Array;
  sizeBytes: number;
  pageCount: number;
}

const sourceStore = new Map<string, LoadedSource>();

export function getWebSource(sourceId: string): LoadedSource | undefined {
  return sourceStore.get(sourceId);
}

export function removeWebSource(sourceId: string): void {
  sourceStore.delete(sourceId);
}

export function clearWebSources(): void {
  sourceStore.clear();
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

async function renderPdfPageToCanvas(
  pdfBytes: Uint8Array,
  pageIndex: number,
  dpi: number
): Promise<HTMLCanvasElement> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  try {
    const safePage = Math.max(1, Math.min(pageIndex + 1, pdf.numPages));
    const page = await pdf.getPage(safePage);
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const targetW = Math.max(1, Math.round(viewport.width));
    const targetH = Math.max(1, Math.round(viewport.height));
    validateCanvasDimensions(targetW, targetH, `PDF page ${safePage} at ${dpi} DPI`);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    await pdf.destroy();
  }
}

async function imageBytesToCanvas(bytes: Uint8Array, mimeHint = 'image/png'): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes.slice()], { type: mimeHint });
  const bitmap = await createImageBitmap(blob);
  try {
    validateCanvasDimensions(bitmap.width, bitmap.height, 'Image');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function renderItemToCanvas(item: StoryboardItem, dpi = 300): Promise<HTMLCanvasElement> {
  const src = sourceStore.get(item.sourceId);
  if (!src) throw new Error(`Source data missing for ${item.fileName}`);
  if (src.kind === 'pdf') {
    return renderPdfPageToCanvas(src.bytes, item.pageIndex, dpi);
  }
  return imageBytesToCanvas(src.bytes);
}

function drawCanvasWatermark(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fontSize = Math.max(11, Math.round(canvas.width * 0.014));
  ctx.save();
  ctx.font = `500 ${fontSize}px sans-serif`;
  ctx.fillStyle = 'rgba(170, 170, 170, 0.32)';
  ctx.textBaseline = 'bottom';
  const metrics = ctx.measureText(WATERMARK_TEXT);
  const x = Math.max(10, canvas.width - metrics.width - 12);
  const y = Math.max(fontSize + 8, canvas.height - 10);
  ctx.fillText(WATERMARK_TEXT, x, y);
  ctx.restore();
}

function encodeCanvasToBmp(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelBytes = rowSize * height;
  const buf = new ArrayBuffer(54 + pixelBytes);
  const view = new DataView(buf);

  view.setUint16(0, 0x4d42, true); // BM
  view.setUint32(2, 54 + pixelBytes, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);

  const bytes = new Uint8Array(buf);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 3;
      bytes[d] = data[s + 2];
      bytes[d + 1] = data[s + 1];
      bytes[d + 2] = data[s];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

function encodeCanvasToTiff(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const rgbSize = width * height * 3;
  const headerSize = 8;
  const stripOffset = headerSize;
  const bpsOffset = stripOffset + rgbSize;
  const ifdOffset = bpsOffset + 6;
  const numEntries = 10;
  const totalSize = ifdOffset + 2 + numEntries * 12 + 4;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);

  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  let p = stripOffset;
  for (let i = 0; i < data.length; i += 4) {
    out[p++] = data[i];
    out[p++] = data[i + 1];
    out[p++] = data[i + 2];
  }

  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);

  let pos = ifdOffset;
  view.setUint16(pos, numEntries, true);
  pos += 2;
  const writeTag = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(pos, tag, true);
    view.setUint16(pos + 2, type, true);
    view.setUint32(pos + 4, count, true);
    view.setUint32(pos + 8, val, true);
    pos += 12;
  };
  writeTag(256, 4, 1, width);
  writeTag(257, 4, 1, height);
  writeTag(258, 3, 3, bpsOffset);
  writeTag(259, 3, 1, 1);
  writeTag(262, 3, 1, 2);
  writeTag(273, 4, 1, stripOffset);
  writeTag(277, 3, 1, 3);
  writeTag(278, 4, 1, height);
  writeTag(279, 4, 1, rgbSize);
  writeTag(284, 3, 1, 1);
  view.setUint32(pos, 0, true);

  return new Blob([buf], { type: 'image/tiff' });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ImageOutputFormat,
  quality = 0.92
): Promise<{ blob: Blob; ext: string; mime: string }> {
  if (format === 'BMP') {
    return { blob: encodeCanvasToBmp(canvas), ext: 'bmp', mime: 'image/bmp' };
  }
  if (format === 'TIFF') {
    return { blob: encodeCanvasToTiff(canvas), ext: 'tiff', mime: 'image/tiff' };
  }

  const map: Record<'JPG' | 'PNG' | 'WEBP', { mime: string; ext: string }> = {
    JPG: { mime: 'image/jpeg', ext: 'jpg' },
    PNG: { mime: 'image/png', ext: 'png' },
    WEBP: { mime: 'image/webp', ext: 'webp' },
  };
  const { mime, ext } = map[format];

  let targetCanvas = canvas;
  if (format === 'JPG') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const fctx = flat.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(canvas, 0, 0);
      targetCanvas = flat;
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    targetCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Failed to encode ${format}`))),
      mime,
      quality
    );
  });
  return { blob, ext, mime };
}

async function compressCanvasToTarget(
  canvas: HTMLCanvasElement,
  format: ImageOutputFormat,
  targetBytes: number | null
): Promise<{ blob: Blob; ext: string; mime: string }> {
  if (!targetBytes || targetBytes <= 0 || format === 'BMP' || format === 'TIFF') {
    return canvasToBlob(canvas, format, 0.92);
  }

  if (format === 'JPG' || format === 'WEBP') {
    let low = 5;
    let high = 95;
    let best: { blob: Blob; ext: string; mime: string } | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const res = await canvasToBlob(canvas, format, mid / 100);
      if (res.blob.size <= targetBytes) {
        best = res;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best ?? canvasToBlob(canvas, format, 0.08);
  }

  // PNG: try original, then progressive downscale if targetBytes is strict
  const base = await canvasToBlob(canvas, 'PNG');
  if (base.blob.size <= targetBytes) return base;
  let best = base;
  for (const scale of [0.85, 0.7, 0.55, 0.4]) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(32, Math.round(canvas.width * scale));
    scaled.height = Math.max(32, Math.round(canvas.height * scale));
    const sctx = scaled.getContext('2d');
    sctx?.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    const cand = await canvasToBlob(scaled, 'PNG');
    best = cand;
    if (cand.blob.size <= targetBytes) break;
  }
  return best;
}

async function applyPdfWatermarkAndMetadata(
  pdfDoc: PDFDocument,
  watermarkEnabled: boolean,
  metadataAction: MetadataAction
): Promise<Uint8Array> {
  if (watermarkEnabled) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 8;
    const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, fontSize);
    for (const page of pdfDoc.getPages()) {
      const { width } = page.getSize();
      page.drawText(WATERMARK_TEXT, {
        x: Math.max(10, width - textWidth - 10),
        y: 10,
        size: fontSize,
        font,
        color: rgb(170 / 255, 170 / 255, 170 / 255),
        opacity: 0.3,
      });
    }
  }

  if (metadataAction === 'strip') {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');
    pdfDoc.setCreationDate(new Date(0));
    pdfDoc.setModificationDate(new Date(0));
  }

  return pdfDoc.save({ useObjectStreams: true });
}

export async function ingestWebFiles(files: File[]): Promise<{
  items: StoryboardItem[];
  rejected: string[];
  encrypted: string[];
}> {
  const items: StoryboardItem[] = [];
  const rejected: string[] = [];
  const encrypted: string[] = [];

  let sessionBytes = 0;
  for (const existing of sourceStore.values()) {
    sessionBytes += existing.sizeBytes;
  }

  for (const file of files) {
    const name = file.name;
    const isPdf = isPdfName(name);
    const lower = name.toLowerCase();
    const supported =
      isPdf || ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'].some((e) => lower.endsWith(e));
    if (!supported) {
      rejected.push(name);
      continue;
    }

    validateWebFileLimits(name, file.size, sessionBytes);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceId = makeId('src');

    if (isPdf) {
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      } catch (err: unknown) {
        const msg = String(err instanceof Error ? err.message : err).toLowerCase();
        if (msg.includes('password')) {
          encrypted.push(name);
          continue;
        }
        throw err;
      }

      try {
        const pageCount = Math.max(1, pdf.numPages);
        if (pageCount > WEB_MAX_PDF_PAGES) {
          throw new Error(
            `PDF "${name}" has ${pageCount} pages, exceeding the ${WEB_MAX_PDF_PAGES}-page browser safety cap. Use the Windows Desktop app for very large PDFs.`
          );
        }
        sessionBytes += file.size;
        sourceStore.set(sourceId, {
          sourceId,
          fileName: name,
          kind: 'pdf',
          bytes,
          sizeBytes: file.size,
          pageCount,
        });

        for (let i = 0; i < pageCount; i++) {
          const page = await pdf.getPage(i + 1);
          const baseVp = page.getViewport({ scale: 1 });
          const scale = Math.min(1.5, 240 / Math.max(1, baseVp.width));
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(vp.width));
          canvas.height = Math.max(1, Math.round(vp.height));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
          }
          items.push({
            id: makeId('item'),
            sourceId,
            fileName: name,
            kind: 'pdf',
            pageIndex: i,
            pageLabel: `Page ${i + 1}`,
            thumbnailUrl: canvas.toDataURL('image/png'),
            sizeBytes: file.size,
            selected: false,
          });
        }
      } finally {
        await pdf.destroy();
      }
    } else {
      const canvas = await imageBytesToCanvas(bytes, file.type || 'image/png');
      sessionBytes += file.size;
      sourceStore.set(sourceId, {
        sourceId,
        fileName: name,
        kind: 'image',
        bytes,
        sizeBytes: file.size,
        pageCount: 1,
      });
      const ratio = Math.min(1, 240 / Math.max(1, canvas.width));
      const thumb = document.createElement('canvas');
      thumb.width = Math.max(1, Math.round(canvas.width * ratio));
      thumb.height = Math.max(1, Math.round(canvas.height * ratio));
      const tctx = thumb.getContext('2d');
      tctx?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      items.push({
        id: makeId('item'),
        sourceId,
        fileName: name,
        kind: 'image',
        pageIndex: 0,
        pageLabel: name,
        thumbnailUrl: thumb.toDataURL('image/png'),
        sizeBytes: file.size,
        selected: false,
      });
    }
  }

  return { items, rejected, encrypted };
}

export async function renderWebFullResPreview(item: StoryboardItem): Promise<string> {
  const canvas = await renderItemToCanvas(item, 200);
  return canvas.toDataURL('image/png');
}

export async function buildWorkingPdfBytes(
  items: StoryboardItem[],
  watermarkEnabled: boolean,
  metadataAction: MetadataAction,
  onProgress?: (pct: number, msg: string) => void
): Promise<Uint8Array> {
  if (items.length === 0) throw new Error('No pages loaded.');

  const outDoc = await PDFDocument.create();
  const loadedPdfs = new Map<string, PDFDocument>();

  const imageWidths: number[] = [];
  for (const item of items) {
    if (item.kind === 'image') {
      const src = sourceStore.get(item.sourceId);
      if (src) {
        const canvas = await imageBytesToCanvas(src.bytes);
        imageWidths.push((canvas.width / 96) * 72);
      }
    }
  }
  imageWidths.sort((a, b) => a - b);
  const medianWidth =
    imageWidths.length > 0
      ? Math.min(imageWidths[Math.floor(imageWidths.length / 2)], 841.89)
      : 595.28;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const src = sourceStore.get(item.sourceId);
    if (!src) continue;
    onProgress?.(Math.round(((i + 1) / items.length) * 85), `Assembling page ${i + 1} of ${items.length}…`);

    if (item.kind === 'pdf') {
      let srcPdf = loadedPdfs.get(src.sourceId);
      if (!srcPdf) {
        srcPdf = await PDFDocument.load(src.bytes);
        loadedPdfs.set(src.sourceId, srcPdf);
      }
      const [copied] = await outDoc.copyPages(srcPdf, [item.pageIndex]);
      outDoc.addPage(copied);
    } else {
      const canvas = await imageBytesToCanvas(src.bytes);
      const { blob } = await canvasToBlob(canvas, 'PNG');
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = await outDoc.embedPng(pngBytes);
      const aspect = canvas.height / Math.max(1, canvas.width);
      let pageH = medianWidth * aspect;
      const maxH = medianWidth * 2;
      const capped = pageH > maxH;
      if (capped) pageH = maxH;
      const page = outDoc.addPage([medianWidth, pageH]);
      if (!capped) {
        page.drawImage(embedded, { x: 0, y: 0, width: medianWidth, height: pageH });
      } else {
        const scale = Math.min(medianWidth / canvas.width, pageH / canvas.height);
        const sw = canvas.width * scale;
        const sh = canvas.height * scale;
        page.drawImage(embedded, {
          x: (medianWidth - sw) / 2,
          y: (pageH - sh) / 2,
          width: sw,
          height: sh,
        });
      }
    }
  }

  onProgress?.(94, 'Finalizing PDF…');
  return applyPdfWatermarkAndMetadata(outDoc, watermarkEnabled, metadataAction);
}

export async function exportWebSeparatePdfs(
  items: StoryboardItem[],
  watermarkEnabled: boolean,
  metadataAction: MetadataAction,
  compressionBytes: number | null,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  const selected = items.filter((i) => i.selected);
  const targets = selected.length > 0 ? selected : items;
  if (targets.length === 0) throw new Error('No items to convert.');

  if (targets.length === 1) {
    if (compressionBytes && compressionBytes > 0) {
      return compressWebTarget(targets, compressionBytes, watermarkEnabled, metadataAction, onProgress);
    }
    const pdfBytes = await buildWorkingPdfBytes(targets, watermarkEnabled, metadataAction, onProgress);
    const stem = getFileStem(targets[0].fileName);
    return {
      fileName: `${stem}_converted.pdf`,
      blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
      mimeType: 'application/pdf',
    };
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    onProgress?.(Math.round(((i + 1) / targets.length) * 92), `Creating PDF ${i + 1} of ${targets.length}…`);
    let bytes: Uint8Array;
    if (compressionBytes && compressionBytes > 0) {
      const comp = await compressWebTarget([item], compressionBytes, watermarkEnabled, metadataAction);
      bytes = new Uint8Array(await comp.blob.arrayBuffer());
    } else {
      bytes = await buildWorkingPdfBytes([item], watermarkEnabled, metadataAction);
    }
    const stem = getFileStem(item.fileName);
    const baseName = item.kind === 'pdf' ? `${stem}_page${item.pageIndex + 1}` : stem;
    let candidate = `${baseName}.pdf`;
    let c = 1;
    while (usedNames.has(candidate)) {
      candidate = `${baseName}_${c++}.pdf`;
    }
    usedNames.add(candidate);
    zip.file(candidate, bytes);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: `deskconvert_${targets.length}_pdfs.zip`,
    blob: zipBlob,
    mimeType: 'application/zip',
  };
}

export async function exportWebPdfToImages(
  items: StoryboardItem[],
  format: ImageOutputFormat,
  dpi: number,
  watermarkEnabled: boolean,
  compressionBytes: number | null,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  if (items.length === 0) throw new Error('Load at least one file to export images.');

  const selected = items.filter((i) => i.selected);
  const targets = selected.length > 0 ? selected : items;
  const firstStem = getFileStem(targets[0].fileName);

  const outputs: Array<{ name: string; blob: Blob; mime: string }> = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    onProgress?.(Math.round(((i + 1) / targets.length) * 90), `Rendering item ${i + 1} of ${targets.length}…`);
    const canvas = await renderItemToCanvas(item, dpi);
    if (watermarkEnabled) drawCanvasWatermark(canvas);
    const { blob, ext, mime } = await compressCanvasToTarget(canvas, format, compressionBytes);
    const stem = getFileStem(item.fileName);
    const base = item.kind === 'pdf' ? `${stem}_page${item.pageIndex + 1}` : stem;
    let candidate = `${base}.${ext}`;
    let c = 1;
    while (usedNames.has(candidate)) {
      candidate = `${base}_${c++}.${ext}`;
    }
    usedNames.add(candidate);
    outputs.push({ name: candidate, blob, mime });
  }

  if (outputs.length === 1) {
    return { fileName: outputs[0].name, blob: outputs[0].blob, mimeType: outputs[0].mime };
  }

  onProgress?.(96, 'Packaging ZIP archive…');
  const zip = new JSZip();
  outputs.forEach((o) => zip.file(o.name, o.blob));
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return { fileName: `${firstStem}_images_${dpi}dpi.zip`, blob: zipBlob, mimeType: 'application/zip' };
}

export async function exportWebSplitPdf(
  items: StoryboardItem[],
  ranges: PageRange[],
  mode: SplitOutputMode,
  watermarkEnabled: boolean,
  metadataAction: MetadataAction,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  if (items.length === 0) throw new Error('No pages loaded to split.');
  const workingBytes = await buildWorkingPdfBytes(items, false, 'keep', onProgress);
  const workingDoc = await PDFDocument.load(workingBytes);
  const total = workingDoc.getPageCount();
  const stem = getFileStem(items[0].fileName);

  if (mode === 'single') {
    const indices = expandRangesToZeroBasedIndices(ranges, total);
    const outDoc = await PDFDocument.create();
    const pages = await outDoc.copyPages(workingDoc, indices);
    pages.forEach((p) => outDoc.addPage(p));
    const finalBytes = await applyPdfWatermarkAndMetadata(outDoc, watermarkEnabled, metadataAction);
    return {
      fileName: `${stem}_split.pdf`,
      blob: new Blob([finalBytes.slice()], { type: 'application/pdf' }),
      mimeType: 'application/pdf',
    };
  }

  const clamped = normalizePageRanges(ranges, total);
  const pageNums = expandRangesToZeroBasedIndices(
    clamped.map(([from, to], idx) => ({ id: String(idx), from, to })),
    total
  );
  const zip = new JSZip();
  for (let i = 0; i < pageNums.length; i++) {
    const pageIdx = pageNums[i];
    onProgress?.(Math.round(((i + 1) / pageNums.length) * 95), `Splitting page ${pageIdx + 1}…`);
    const singleDoc = await PDFDocument.create();
    const [copied] = await singleDoc.copyPages(workingDoc, [pageIdx]);
    singleDoc.addPage(copied);
    const bytes = await applyPdfWatermarkAndMetadata(singleDoc, watermarkEnabled, metadataAction);
    zip.file(`${stem}_page${pageIdx + 1}.pdf`, bytes);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return { fileName: `${stem}_split_pages.zip`, blob: zipBlob, mimeType: 'application/zip' };
}

export async function exportWebBatchImages(
  items: StoryboardItem[],
  format: ImageOutputFormat,
  dpi: number,
  watermarkEnabled: boolean,
  compressionBytes: number | null,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  // Universal batch convert: converts ALL selected/loaded items (both PDF pages and images!)
  return exportWebPdfToImages(items, format, dpi, watermarkEnabled, compressionBytes, onProgress);
}

async function compressSinglePdfGroup(
  groupItems: StoryboardItem[],
  targetBytes: number,
  watermarkEnabled: boolean,
  metadataAction: MetadataAction,
  onProgress?: (pct: number, msg: string) => void
): Promise<Uint8Array> {
  const baseBytes = await buildWorkingPdfBytes(groupItems, watermarkEnabled, metadataAction, onProgress);
  if (baseBytes.length <= targetBytes) return baseBytes;

  const attempts: Array<[number, number]> = [
    [144, 0.78],
    [110, 0.65],
    [90, 0.52],
    [72, 0.4],
    [72, 0.28],
  ];
  let bestBytes = baseBytes;
  const loadedPdf = await pdfjsLib.getDocument({ data: baseBytes.slice() }).promise;
  try {
    for (let idx = 0; idx < attempts.length; idx++) {
      const [dpi, qual] = attempts[idx];
      onProgress?.(35 + idx * 12, `Targeting size (${dpi} DPI)…`);
      const candDoc = await PDFDocument.create();
      for (let p = 1; p <= loadedPdf.numPages; p++) {
        const page = await loadedPdf.getPage(p);
        const vp = page.getViewport({ scale: dpi / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
        const { blob } = await canvasToBlob(canvas, 'JPG', qual);
        const jpgBytes = new Uint8Array(await blob.arrayBuffer());
        const img = await candDoc.embedJpg(jpgBytes);
        const origVp = page.getViewport({ scale: 1 });
        const outPage = candDoc.addPage([origVp.width, origVp.height]);
        outPage.drawImage(img, { x: 0, y: 0, width: origVp.width, height: origVp.height });
      }
      const candBytes = await applyPdfWatermarkAndMetadata(candDoc, false, metadataAction);
      if (candBytes.length < bestBytes.length) bestBytes = candBytes;
      if (candBytes.length <= targetBytes) {
        bestBytes = candBytes;
        break;
      }
    }
  } finally {
    await loadedPdf.destroy();
  }
  return bestBytes;
}

export async function compressWebTarget(
  items: StoryboardItem[],
  targetBytes: number,
  watermarkEnabled: boolean,
  metadataAction: MetadataAction,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  if (items.length === 0) throw new Error('No file loaded to compress.');
  const selected = items.filter((i) => i.selected);
  const targets = selected.length > 0 ? selected : items;

  const hasPdf = targets.some((i) => i.kind === 'pdf');
  const hasImage = targets.some((i) => i.kind === 'image');
  const firstStem = getFileStem(targets[0].fileName);

  // If all targets are images (1 or many), compress each image individually
  if (hasImage && !hasPdf) {
    const outputs: Array<{ name: string; blob: Blob; mime: string }> = [];
    const usedNames = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      onProgress?.(Math.round(((i + 1) / targets.length) * 90), `Compressing ${item.fileName}…`);
      const canvas = await renderItemToCanvas(item, 300);
      if (watermarkEnabled) drawCanvasWatermark(canvas);
      const isWebp = item.fileName.toLowerCase().endsWith('.webp');
      const isPng = item.fileName.toLowerCase().endsWith('.png');
      const fmt: ImageOutputFormat = isWebp ? 'WEBP' : isPng ? 'PNG' : 'JPG';
      const { blob, ext, mime } = await compressCanvasToTarget(canvas, fmt, targetBytes);
      const stem = getFileStem(item.fileName);
      let candidate = `${stem}_compressed.${ext}`;
      let c = 1;
      while (usedNames.has(candidate)) {
        candidate = `${stem}_compressed_${c++}.${ext}`;
      }
      usedNames.add(candidate);
      outputs.push({ name: candidate, blob, mime });
    }
    if (outputs.length === 1) {
      return { fileName: outputs[0].name, blob: outputs[0].blob, mimeType: outputs[0].mime };
    }
    const zip = new JSZip();
    outputs.forEach((o) => zip.file(o.name, o.blob));
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return {
      fileName: `${firstStem}_compressed_${outputs.length}_files.zip`,
      blob: zipBlob,
      mimeType: 'application/zip',
    };
  }

  // PDF or mixed storyboard compression
  const pdfBytes = await compressSinglePdfGroup(
    targets,
    targetBytes,
    watermarkEnabled,
    metadataAction,
    onProgress
  );
  return {
    fileName: `${firstStem}_compressed.pdf`,
    blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
    mimeType: 'application/pdf',
  };
}

function sanitizeWinAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, ' ').trim();
}

export async function runWebOcr(
  items: StoryboardItem[],
  mode: OcrOutputMode,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ fileName: string; blob: Blob; mimeType: string }> {
  if (items.length === 0) throw new Error('Load a PDF or image to run OCR.');
  const selected = items.filter((i) => i.selected);
  const targets = selected.length > 0 ? selected : items;
  const stem = getFileStem(targets[0].fileName);

  onProgress?.(5, 'Initializing local Tesseract OCR engine…');
  // Pinned exact CDN versions (tesseract.js@5.1.1, tesseract.js-core@5.1.1, @tesseract.js-data/eng@1.0.0)
  // to prevent mutable @latest tag drift on jsDelivr.
  const worker = await createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
  });

  try {
    const pageTexts: string[] = [];
    const searchableDoc = mode === 'searchable_pdf' ? await PDFDocument.create() : null;
    const font = searchableDoc ? await searchableDoc.embedFont(StandardFonts.Helvetica) : null;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      onProgress?.(
        Math.round(10 + ((i + 0.5) / targets.length) * 85),
        `Recognizing text on item ${i + 1} of ${targets.length} (${item.fileName})…`
      );

      const canvas = await renderItemToCanvas(item, 200);
      const result = await worker.recognize(canvas);
      pageTexts.push(`--- Page ${i + 1} (${item.fileName}) ---\n${result.data.text || ''}\n`);

      if (searchableDoc && font) {
        const { blob } = await canvasToBlob(canvas, 'JPG', 0.88);
        const imgBytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = await searchableDoc.embedJpg(imgBytes);
        const ptW = (canvas.width / 200) * 72;
        const ptH = (canvas.height / 200) * 72;
        const page = searchableDoc.addPage([ptW, ptH]);
        page.drawImage(embedded, { x: 0, y: 0, width: ptW, height: ptH });

        const words = (result.data as unknown as { words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }).words || [];
        for (const word of words) {
          const clean = sanitizeWinAnsi(word.text);
          if (!clean) continue;
          const xPt = (word.bbox.x0 / canvas.width) * ptW;
          const yPt = ptH - (word.bbox.y1 / canvas.height) * ptH;
          const boxH = Math.max(6, ((word.bbox.y1 - word.bbox.y0) / canvas.height) * ptH);
          page.drawText(clean, {
            x: xPt,
            y: Math.max(2, yPt),
            size: Math.min(28, boxH * 0.85),
            font,
            opacity: 0,
          });
        }
      }
    }

    if (mode === 'text_file') {
      return {
        fileName: `${stem}_ocr.txt`,
        blob: new Blob([pageTexts.join('\n')], { type: 'text/plain;charset=utf-8' }),
        mimeType: 'text/plain',
      };
    }

    const pdfBytes = await searchableDoc!.save({ useObjectStreams: true });
    return {
      fileName: `${stem}_searchable.pdf`,
      blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
      mimeType: 'application/pdf',
    };
  } finally {
    await worker.terminate();
  }
}

export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
