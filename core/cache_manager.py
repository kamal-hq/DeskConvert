import atexit
import base64
import io
import os
import shutil
import tempfile
import uuid
from typing import Dict, List, Optional

import pymupdf as fitz
from PIL import Image


class CacheManager:
    """Stages source files into an isolated OS temp dir and renders thumbnails/previews."""

    def __init__(self):
        self.temp_dir = tempfile.mkdtemp(prefix="deskconvert_")
        self.file_map: Dict[str, str] = {}  # original_path -> cached_path
        atexit.register(self.clear_cache)

    def stage_file(self, source_filepath: str) -> str:
        """Copies source file into temp directory. Returns cached copy path."""
        if not os.path.isfile(source_filepath):
            raise FileNotFoundError(f"Source file not found: {source_filepath}")

        if source_filepath in self.file_map and os.path.exists(self.file_map[source_filepath]):
            return self.file_map[source_filepath]

        filename = os.path.basename(source_filepath)
        base, ext = os.path.splitext(filename)
        unique_name = f"{base}_{uuid.uuid4().hex[:8]}{ext}"
        cached_path = os.path.join(self.temp_dir, unique_name)

        shutil.copy2(source_filepath, cached_path)
        self.file_map[source_filepath] = cached_path
        return cached_path

    def stage_files(self, file_list: List[str]) -> Dict[str, str]:
        """Stages multiple files. Returns {original_path: cached_path}."""
        return {f: self.stage_file(f) for f in file_list}

    def get_cached_path(self, original_path: str) -> Optional[str]:
        return self.file_map.get(original_path)

    def generate_thumbnail_bytes(
        self, cached_filepath: str, page_number: int = 0, max_width: int = 280
    ) -> bytes:
        """Renders low-res PNG bytes for UI display without any UI toolkit dependency."""
        _, ext = os.path.splitext(cached_filepath)
        if ext.lower() == ".pdf":
            with fitz.open(cached_filepath) as doc:
                if len(doc) == 0:
                    raise ValueError("PDF contains no pages.")
                safe_page = max(0, min(page_number, len(doc) - 1))
                page = doc.load_page(safe_page)
                zoom = min(2.0, max_width / max(1.0, page.rect.width))
                pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                return pix.tobytes("png")
        with Image.open(cached_filepath) as img:
            copy = img.copy()
            copy.thumbnail((max_width, 99999), Image.Resampling.LANCZOS)
            if copy.mode not in ("RGB", "RGBA"):
                copy = copy.convert("RGB")
            buf = io.BytesIO()
            copy.save(buf, format="PNG")
            return buf.getvalue()

    def get_full_res_page_bytes(
        self, cached_filepath: str, page_number: int = 0, dpi: int = 200
    ) -> bytes:
        """Renders full-resolution PNG bytes for the preview modal."""
        _, ext = os.path.splitext(cached_filepath)
        if ext.lower() == ".pdf":
            with fitz.open(cached_filepath) as doc:
                if len(doc) == 0:
                    raise ValueError("PDF contains no pages.")
                safe_page = max(0, min(page_number, len(doc) - 1))
                page = doc.load_page(safe_page)
                scale = dpi / 72.0
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                return pix.tobytes("png")
        with Image.open(cached_filepath) as img:
            copy = img.copy()
            if copy.mode not in ("RGB", "RGBA"):
                copy = copy.convert("RGB")
            buf = io.BytesIO()
            copy.save(buf, format="PNG")
            return buf.getvalue()

    def get_thumbnail_data_url(self, cached_filepath: str, page_number: int = 0) -> str:
        raw = self.generate_thumbnail_bytes(cached_filepath, page_number)
        return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")

    def get_full_res_data_url(self, cached_filepath: str, page_number: int = 0) -> str:
        raw = self.get_full_res_page_bytes(cached_filepath, page_number)
        return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")

    def get_page_count(self, cached_filepath: str) -> int:
        """PDF: actual page count. Image: returns 1."""
        _, ext = os.path.splitext(cached_filepath)
        if ext.lower() == ".pdf":
            try:
                with fitz.open(cached_filepath) as doc:
                    return max(1, len(doc))
            except Exception:
                return 1
        return 1

    def clear_cache(self) -> None:
        """Deletes all files in temp directory. Safe to call repeatedly."""
        try:
            if self.temp_dir and os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir, ignore_errors=True)
        except Exception:
            pass
        self.file_map.clear()
