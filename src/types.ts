export type ToolMode =
  | 'pdf_to_image'
  | 'image_to_pdf'
  | 'merge'
  | 'split'
  | 'batch_convert'
  | 'ocr';

export type ImageOutputFormat = 'JPG' | 'PNG' | 'WEBP' | 'BMP' | 'TIFF';
export type SplitOutputMode = 'single' | 'individual';
export type OcrOutputMode = 'searchable_pdf' | 'text_file';
export type MetadataAction = 'keep' | 'strip';
export type ThemeMode = 'dark' | 'light';

export interface StoryboardItem {
  id: string;
  sourceId: string;
  fileName: string;
  kind: 'pdf' | 'image';
  pageIndex: number; // 0-indexed page in source PDF (0 for images)
  pageLabel: string;
  thumbnailUrl: string;
  sizeBytes: number;
  selected: boolean;
}

export interface PageRange {
  id: string;
  from: number;
  to: number;
}

export interface AppSettings {
  defaultOutputDirectory: string;
  quickSaveEnabled: boolean;
  watermarkEnabled: boolean;
  metadataAction: MetadataAction;
  dpi: 'screen' | 'print' | 'custom';
  customDpi: number;
  theme: ThemeMode;
}

export interface HistoryEntry {
  id: string;
  name: string;
  path?: string;
  kind: 'pdf' | 'image';
  pageCount: number;
  sizeBytes: number;
  timestamp: number;
  exists?: boolean;
}

export interface CompressionEstimate {
  currentBytes: number;
  targetBytes: number;
  suggestedQuality: number;
  reductionPercent: number;
  estimatedBytes: number;
}

export interface ExportArtifact {
  fileName: string;
  mimeType: string;
  blob?: Blob;
  savedPath?: string;
  sizeBytes: number;
}

export interface ExportResult {
  summary: string;
  outputCount: number;
  artifacts: ExportArtifact[];
  outputDir?: string;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  artifact?: ExportArtifact;
  outputDir?: string;
}
