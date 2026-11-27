import os
import statistics
from typing import List, Optional, Tuple, Union

import pymupdf as fitz
from PIL import Image as PilImage

from core.export import ExportEngine
from core.metadata import keep_metadata, strip_metadata
from core.watermark import apply_watermark
from utils.validators import Validators

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


def _read_image_pt_dims(image_path: str) -> Tuple[float, float]:
    """Reads image dimensions converted to PDF points using embedded DPI (fallback 96)."""
    with PilImage.open(image_path) as img:
        img_w, img_h = img.size
        dpi_info = img.info.get("dpi", (96, 96))
        dpi_x = float(dpi_info[0]) if dpi_info and dpi_info[0] > 0 else 96.0
        dpi_y = float(dpi_info[1]) if dpi_info and len(dpi_info) > 1 and dpi_info[1] > 0 else dpi_x
    return (img_w / dpi_x) * 72.0, (img_h / dpi_y) * 72.0


def _insert_scaled_image_page(doc: fitz.Document, image_path: str, ref_w: float) -> None:
    """Adds a page sized cleanly around ref_w while capping extreme tall aspect ratios."""
    pt_w, pt_h = _read_image_pt_dims(image_path)
    aspect = pt_h / max(1.0, pt_w)
    page_h = ref_w * aspect
    max_h = ref_w * 2.0
    capped = page_h > max_h
    if capped:
        page_h = max_h

    page = doc.new_page(width=ref_w, height=page_h)
    if not capped:
        rect = fitz.Rect(0, 0, ref_w, page_h)
        page.insert_image(rect, filename=image_path, keep_proportion=False)
    else:
        scale = min(ref_w / pt_w, page_h / pt_h)
        sw = pt_w * scale
        sh = pt_h * scale
        x0 = (ref_w - sw) / 2.0
        y0 = (page_h - sh) / 2.0
        rect = fitz.Rect(x0, y0, x0 + sw, y0 + sh)
        page.insert_image(rect, filename=image_path, keep_proportion=True)


class PdfEngine:
    """Core engine for processing PDF and image conversions."""

    @staticmethod
    def _post_process(
        output_path: str,
        watermark_enabled: bool,
        metadata_action: str,
        source_path_for_keep: Optional[str] = None,
    ) -> None:
        if watermark_enabled:
            apply_watermark(output_path)
        if metadata_action == "strip":
            strip_metadata(output_path)
        elif metadata_action == "keep" and source_path_for_keep:
            keep_metadata(source_path_for_keep, output_path)

    @staticmethod
    def build_working_pdf(ordered_items: List[Tuple[str, int]], output_path: str) -> str:
        """
        Materializes an ordered storyboard [(cached_path, 0_based_page_idx), ...] into a single PDF
        so page deletions and reorderings propagate into every PDF workflow.
        """
        if not ordered_items:
            raise ValueError("No pages or images provided.")

        image_paths = [
            p for p, _ in ordered_items if os.path.splitext(p)[1].lower() in IMAGE_EXTS
        ]
        ref_w = 841.89
        if image_paths:
            widths = [_read_image_pt_dims(p)[0] for p in image_paths]
            ref_w = min(statistics.median(widths), 841.89)

        out_doc = fitz.open()
        open_pdfs = {}
        try:
            for file_path, page_idx in ordered_items:
                ext = os.path.splitext(file_path)[1].lower()
                if ext == ".pdf":
                    src = open_pdfs.get(file_path)
                    if src is None:
                        src = fitz.open(file_path)
                        open_pdfs[file_path] = src
                    if 0 <= page_idx < len(src):
                        out_doc.insert_pdf(src, from_page=page_idx, to_page=page_idx)
                elif ext in IMAGE_EXTS:
                    _insert_scaled_image_page(out_doc, file_path, ref_w)
            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
            out_doc.save(output_path)
        finally:
            out_doc.close()
            for src in open_pdfs.values():
                src.close()
        return output_path

    @staticmethod
    def pdf_to_images(
        cached_pdf_path: str,
        output_folder: str,
        filename_stem: str,
        dpi: int = 300,
        fmt: str = "jpg",
        page_indices: Optional[List[int]] = None,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
    ) -> List[str]:
        """Extracts selected (or all) pages as images into output_folder."""
        safe_folder = Validators.validate_local_path(output_folder)
        safe_stem = Validators.sanitize_filename_stem(filename_stem, fallback="document")
        os.makedirs(safe_folder, exist_ok=True)
        ext = "".join(ch for ch in fmt.lower().lstrip(".") if ch.isalnum())[:8]
        if ext == "jpeg":
            ext = "jpg"

        output_paths: List[str] = []
        with fitz.open(cached_pdf_path) as doc:
            target_pages = (
                [p for p in page_indices if 0 <= p < len(doc)]
                if page_indices is not None
                else list(range(len(doc)))
            )
            if not target_pages:
                raise ValueError("No valid pages selected for image export.")

            for page_num in target_pages:
                page = doc.load_page(page_num)
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                out_path = os.path.join(safe_folder, f"{safe_stem}_page{page_num + 1}.{ext}")
                if not Validators.is_path_within(out_path, safe_folder):
                    raise ValueError("Refused to write image outside target directory.")
                if os.path.exists(out_path):
                    out_path = ExportEngine.safe_output_path(
                        safe_folder, f"{safe_stem}_page{page_num + 1}", f".{ext}"
                    )
                pix.save(out_path)
                PdfEngine._post_process(out_path, watermark_enabled, metadata_action)
                output_paths.append(out_path)

        return output_paths

    @staticmethod
    def merge_to_pdf(
        ordered_file_list: List[Union[str, Tuple[str, int]]],
        output_path: str,
        watermark_enabled: bool = True,
        metadata_action: str = "keep",
    ) -> str:
        """Merges ordered file paths OR storyboard (path, page_idx) tuples into a single PDF."""
        if not ordered_file_list:
            raise ValueError("No files provided to merge.")

        normalized_items: List[Tuple[str, int]] = []
        open_counts = {}
        for entry in ordered_file_list:
            if isinstance(entry, tuple):
                normalized_items.append((entry[0], int(entry[1])))
            else:
                ext = os.path.splitext(entry)[1].lower()
                if ext == ".pdf":
                    if entry not in open_counts:
                        with fitz.open(entry) as d:
                            open_counts[entry] = len(d)
                    for idx in range(open_counts[entry]):
                        normalized_items.append((entry, idx))
                else:
                    normalized_items.append((entry, 0))

        PdfEngine.build_working_pdf(normalized_items, output_path)
        source_pdf = next((p for p, _ in normalized_items if p.lower().endswith(".pdf")), None)
        PdfEngine._post_process(output_path, watermark_enabled, metadata_action, source_pdf)
        return output_path

    @staticmethod
    def split_pdf(
        cached_pdf_path: str,
        page_ranges: List[Tuple[int, int]],
        output_mode: str,
        output_path_or_folder: str,
        filename_stem: str,
        watermark_enabled: bool = True,
        metadata_action: str = "keep",
    ) -> List[str]:
        """
        Splits PDF based on 1-indexed page_ranges.
        output_mode 'single': combines selected ranges into one PDF at output_path_or_folder.
        output_mode 'individual': saves each selected page as a separate PDF in output_path_or_folder.
        """
        output_paths: List[str] = []
        with fitz.open(cached_pdf_path) as doc:
            total = len(doc)
            if total == 0:
                raise ValueError("Cannot split an empty PDF.")
            if not page_ranges:
                page_ranges = [(1, total)]

            clamped_ranges: List[Tuple[int, int]] = []
            for start, end in page_ranges:
                s = max(1, min(int(start), total))
                e = max(1, min(int(end), total))
                if s <= e:
                    clamped_ranges.append((s, e))

            if not clamped_ranges:
                raise ValueError("No valid page ranges within document bounds.")

            if output_mode == "single":
                os.makedirs(os.path.dirname(os.path.abspath(output_path_or_folder)), exist_ok=True)
                with fitz.open() as new_doc:
                    for start, end in clamped_ranges:
                        new_doc.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
                    new_doc.save(output_path_or_folder)
                PdfEngine._post_process(
                    output_path_or_folder, watermark_enabled, metadata_action, cached_pdf_path
                )
                output_paths.append(output_path_or_folder)

            elif output_mode == "individual":
                safe_folder = Validators.validate_local_path(output_path_or_folder)
                safe_stem = Validators.sanitize_filename_stem(filename_stem, fallback="document")
                os.makedirs(safe_folder, exist_ok=True)
                seen_pages = set()
                for start, end in clamped_ranges:
                    for page_num in range(start, end + 1):
                        if page_num in seen_pages:
                            continue
                        seen_pages.add(page_num)
                        out_path = os.path.join(
                            safe_folder, f"{safe_stem}_page{page_num}.pdf"
                        )
                        if not Validators.is_path_within(out_path, safe_folder):
                            raise ValueError("Refused to write split PDF outside target directory.")
                        if os.path.exists(out_path):
                            out_path = ExportEngine.safe_output_path(
                                safe_folder, f"{safe_stem}_page{page_num}", ".pdf"
                            )
                        with fitz.open() as new_doc:
                            new_doc.insert_pdf(doc, from_page=page_num - 1, to_page=page_num - 1)
                            new_doc.save(out_path)
                        PdfEngine._post_process(
                            out_path, watermark_enabled, metadata_action, cached_pdf_path
                        )
                        output_paths.append(out_path)
            else:
                raise ValueError(f"Unsupported split output mode: {output_mode}")

        return output_paths

    @staticmethod
    def image_to_pdf(
        image_path_list: List[str],
        output_path: str,
        watermark_enabled: bool = True,
        metadata_action: str = "keep",
    ) -> str:
        if not image_path_list:
            raise ValueError("No images provided.")

        widths = [_read_image_pt_dims(p)[0] for p in image_path_list]
        ref_w = min(statistics.median(widths), 841.89)

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with fitz.open() as out_doc:
            for img_path in image_path_list:
                _insert_scaled_image_page(out_doc, img_path, ref_w)
            out_doc.save(output_path)

        PdfEngine._post_process(output_path, watermark_enabled, metadata_action)
        return output_path

    @staticmethod
    def get_page_count(cached_pdf_path: str) -> int:
        try:
            with fitz.open(cached_pdf_path) as doc:
                return len(doc)
        except Exception:
            return 0
