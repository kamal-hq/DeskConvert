import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  WATERMARK_TEXT,
  WEB_MAX_CANVAS_PIXELS,
  WEB_MAX_FILE_BYTES,
  WEB_MAX_PDF_PAGES,
  WEB_MAX_SESSION_BYTES,
  expandRangesToZeroBasedIndices,
  validateCanvasDimensions,
  validateWebFileLimits,
} from './adapter';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('security-compliance-audit web regression suite', () => {
  it('enforces exact Vercel security headers and keeps CSP strictly Report-Only', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf-8'));
    expect(Array.isArray(vercel.headers)).toBe(true);
    const rootRule = vercel.headers.find((h: { source: string }) => h.source === '/(.*)');
    expect(rootRule).toBeDefined();

    const headerMap = new Map<string, string>(
      rootRule.headers.map((h: { key: string; value: string }) => [h.key, h.value])
    );

    // Enforced security headers
    expect(headerMap.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headerMap.get('X-Frame-Options')).toBe('DENY');
    expect(headerMap.get('Referrer-Policy')).toBe('no-referrer');
    expect(headerMap.get('Permissions-Policy')).toContain('camera=()');
    expect(headerMap.get('Cross-Origin-Opener-Policy')).toBe('same-origin');

    // CSP MUST be Report-Only, NEVER enforced yet
    expect(headerMap.has('Content-Security-Policy')).toBe(false);
    const csp = headerMap.get('Content-Security-Policy-Report-Only') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('blob:');
    expect(csp).toContain('data:');
    expect(csp).toContain("worker-src 'self' blob: https://cdn.jsdelivr.net");
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Fonts are self-hosted — Google Fonts CDN must NOT appear in CSP
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');
  });

  it('bundles self-hosted fonts and pdf.js worker in dist_web with zero Google Fonts CDN references', () => {
    const distDir = path.join(REPO_ROOT, 'dist_web');
    const assetsDir = path.join(distDir, 'assets');
    expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);

    const assets = fs.readdirSync(assetsDir);
    expect(assets.some((f) => /^manrope-latin-400-.*\.woff2$/.test(f))).toBe(true);
    expect(assets.some((f) => /^manrope-latin-700-.*\.woff2$/.test(f))).toBe(true);
    expect(assets.some((f) => /^dm-mono-latin-400-.*\.woff2$/.test(f))).toBe(true);
    expect(assets.some((f) => /^dm-mono-latin-500-.*\.woff2$/.test(f))).toBe(true);
    expect(assets.some((f) => /^pdf\.worker\.min-.*\.mjs$/.test(f))).toBe(true);

    for (const file of ['index.html', ...assets.filter((a) => a.endsWith('.css') || a.endsWith('.js')).map((a) => path.join('assets', a))]) {
      const content = fs.readFileSync(path.join(distDir, file), 'utf-8');
      expect(content).not.toContain('fonts.googleapis.com');
      expect(content).not.toContain('fonts.gstatic.com');
    }
  });

  it('performs real pdf-lib merge, split, watermark, and metadata-strip workflows cleanly', async () => {
    // Build a realistic 3-page PDF
    const srcDoc = await PDFDocument.create();
    srcDoc.setTitle('Confidential Title');
    srcDoc.setAuthor('Muhammad Kamal');
    const font = await srcDoc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 3; i++) {
      const p = srcDoc.addPage([400, 550]);
      p.drawText(`Page ${i + 1}`, { x: 40, y: 500, size: 16, font });
    }
    const srcBytes = await srcDoc.save();

    // Split pages 1 and 3, apply watermark, strip metadata
    const loaded = await PDFDocument.load(srcBytes);
    const indices = expandRangesToZeroBasedIndices(
      [
        { id: 'r1', from: 1, to: 1 },
        { id: 'r2', from: 3, to: 3 },
      ],
      loaded.getPageCount()
    );
    expect(indices).toEqual([0, 2]);

    const outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(loaded, indices);
    const outFont = await outDoc.embedFont(StandardFonts.Helvetica);
    for (const page of copied) {
      outDoc.addPage(page);
      page.drawText(WATERMARK_TEXT, {
        x: 20,
        y: 10,
        size: 8,
        font: outFont,
        color: rgb(0.66, 0.66, 0.66),
        opacity: 0.3,
      });
    }
    outDoc.setTitle('');
    outDoc.setAuthor('');
    const outBytes = await outDoc.save({ useObjectStreams: true });

    const reloaded = await PDFDocument.load(outBytes);
    expect(reloaded.getPageCount()).toBe(2);
    expect(reloaded.getTitle() || '').toBe('');
    expect(reloaded.getAuthor() || '').toBe('');
  });

  it('verifies compliance pages, external link hardening, email spelling, and zero placeholders', () => {
    const legalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/LegalModal.tsx'), 'utf-8');
    const modalsSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/Modals.tsx'), 'utf-8');
    const notices = fs.readFileSync(path.join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf-8');
    const audit = fs.readFileSync(path.join(REPO_ROOT, 'SECURITY_AUDIT.md'), 'utf-8');
    const envExample = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf-8');

    // Exact contact email and zero typo
    for (const doc of [legalSrc, notices, audit]) {
      expect(doc).toContain('muhammad.kamal.hq@gmail.com');
      expect(doc.toLowerCase()).not.toContain('kamak');
    }

    // Zero leftover bracketed template placeholders
    for (const doc of [legalSrc, notices, audit, envExample]) {
      expect(doc).not.toMatch(/\[CONTACT_EMAIL\]|\[NAME\]|\[YOUR_|\[INSERT|\[EFFECTIVE_DATE\]|\[COMPANY|\[EMAIL\]/);
    }

    // Privacy policy discloses Desktop full-path history storage, self-hosted fonts, and jsDelivr Web OCR
    expect(legalSrc).toContain('settings.json');
    expect(legalSrc).toContain('full local filesystem paths');
    expect(legalSrc).toContain('self-hosted');
    expect(legalSrc).toContain('cdn.jsdelivr.net');

    // Every target="_blank" link uses rel="noopener noreferrer"
    for (const src of [legalSrc, modalsSrc]) {
      const blankAnchors = src.match(/<a[\s\S]*?target="_blank"[\s\S]*?>/g) || [];
      expect(blankAnchors.length).toBeGreaterThan(0);
      for (const tag of blankAnchors) {
        expect(tag).toContain('rel="noopener noreferrer"');
      }
    }

    // All hardcoded external https URLs in src/ stay inside github.com/kamal-hq/DeskConvert
    const adapterSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/engines/adapter.ts'), 'utf-8');
    const urls = [...(adapterSrc.match(/https:\/\/[^\s'"]+/g) || []), ...(legalSrc.match(/https:\/\/[^\s'"]+/g) || [])];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('https://github.com/kamal-hq/DeskConvert')).toBe(true);
    }

    // Web OCR pins exact CDN versions (no mutable @latest tag)
    const webEngineSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/engines/webEngine.ts'), 'utf-8');
    expect(webEngineSrc).toContain('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js');
    expect(webEngineSrc).toContain('https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1');
    expect(webEngineSrc).toContain('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int');
  });

  it('keeps generous web safety caps for normal documents while blocking extreme bombs', () => {
    expect(WEB_MAX_FILE_BYTES).toBe(250 * 1024 * 1024);
    expect(WEB_MAX_SESSION_BYTES).toBe(600 * 1024 * 1024);
    expect(WEB_MAX_PDF_PAGES).toBe(1000);
    expect(WEB_MAX_CANVAS_PIXELS).toBe(64_000_000);

    // Normal large multi-file session succeeds
    expect(() => validateWebFileLimits('deck.pdf', 80 * 1024 * 1024, 200 * 1024 * 1024)).not.toThrow();
    // 600 DPI Letter page (5100 x 6600 = 33.66 MP) succeeds
    expect(() => validateCanvasDimensions(5100, 6600, 'Letter @ 600 DPI')).not.toThrow();
    // Zero-dimension malformed image rejected
    expect(() => validateCanvasDimensions(0, 100, 'Corrupt')).toThrow(/invalid dimensions/i);
  });
});
