import type {
  AppSettings,
  ExportResult,
  HistoryEntry,
  ImageOutputFormat,
  OcrOutputMode,
  PageRange,
  SplitOutputMode,
  StoryboardItem,
} from '../types';

export interface DesktopBridgeApi {
  get_app_info(): Promise<{ version: string; platform: string; isDesktop: boolean }>;
  get_settings(): Promise<AppSettings>;
  save_settings(updates: Partial<AppSettings>): Promise<AppSettings>;
  pick_output_directory(): Promise<string | null>;
  pick_files(): Promise<string[]>;
  pick_folder(): Promise<string[]>;
  stage_paths(paths: string[]): Promise<{
    items: StoryboardItem[];
    rejected: string[];
    encrypted: string[];
  }>;
  stage_uploaded_files(files: Array<{ name: string; base64: string }>): Promise<{
    items: StoryboardItem[];
    rejected: string[];
    encrypted: string[];
  }>;
  get_full_res_preview(sourcePath: string, pageIndex: number): Promise<string>;
  get_history(): Promise<HistoryEntry[]>;
  clear_history(): Promise<void>;
  open_path(path: string): Promise<void>;
  open_external_url(url: string): Promise<boolean>;
  export_pdf_to_images(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    format: ImageOutputFormat;
    dpi: number;
    watermarkEnabled: boolean;
    metadataAction: string;
    compressionBytes: number | null;
  }): Promise<ExportResult | null>;
  export_images_to_pdf(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    watermarkEnabled: boolean;
    metadataAction: string;
    compressionBytes: number | null;
    separateFiles?: boolean;
  }): Promise<ExportResult | null>;
  merge_files(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    watermarkEnabled: boolean;
    metadataAction: string;
    compressionBytes: number | null;
  }): Promise<ExportResult | null>;
  split_pdf(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    ranges: PageRange[];
    mode: SplitOutputMode;
    watermarkEnabled: boolean;
    metadataAction: string;
  }): Promise<ExportResult | null>;
  batch_convert_images(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    format: ImageOutputFormat;
    dpi?: number;
    watermarkEnabled: boolean;
    metadataAction: string;
    compressionBytes: number | null;
  }): Promise<ExportResult | null>;
  run_ocr(payload: {
    items: Array<{ sourceId: string; pageIndex: number }>;
    mode: OcrOutputMode;
  }): Promise<ExportResult | null>;
}

export function getDesktopApi(): DesktopBridgeApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { pywebview?: { api?: DesktopBridgeApi } };
  return w.pywebview?.api ?? null;
}
