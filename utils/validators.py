import os
import re
import warnings
from typing import List
from urllib.parse import urlsplit

import pymupdf as fitz  # PyMuPDF
from PIL import Image

# Safety limits against decompression bombs and memory abuse (generous for normal files)
MAX_IMAGE_PIXELS = 178_956_970  # ~179 megapixels (explicit Pillow decompression-bomb threshold)
MAX_DESKTOP_FILE_BYTES = 500 * 1024 * 1024  # 500 MB per local file
MAX_DESKTOP_UPLOAD_DROP_BYTES = 250 * 1024 * 1024  # 250 MB per IPC base64 drop
MAX_DESKTOP_PDF_PAGES = 2_000  # 2,000 pages per PDF document
MAX_RENDER_PIXELS = 100_000_000  # 100 megapixels per rasterized PDF page

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

WINDOWS_RESERVED_NAMES = frozenset({
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
})

_ILLEGAL_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_SAFE_EXT_RE = re.compile(r'^\.[a-zA-Z0-9]{1,8}$')

ALLOWED_EXTERNAL_HOST = "github.com"
ALLOWED_EXTERNAL_PATH_PREFIX = "/kamal-hq/DeskConvert"


class Validators:
    SUPPORTED_PDF = {".pdf"}
    SUPPORTED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}
    SUPPORTED_ALL = SUPPORTED_PDF | SUPPORTED_IMAGE

    @staticmethod
    def is_supported_file(filepath: str) -> bool:
        _, ext = os.path.splitext(filepath)
        return ext.lower() in Validators.SUPPORTED_ALL

    @staticmethod
    def is_pdf(filepath: str) -> bool:
        _, ext = os.path.splitext(filepath)
        return ext.lower() in Validators.SUPPORTED_PDF

    @staticmethod
    def is_image(filepath: str) -> bool:
        _, ext = os.path.splitext(filepath)
        return ext.lower() in Validators.SUPPORTED_IMAGE

    @staticmethod
    def is_password_protected(filepath: str) -> bool:
        if not Validators.is_pdf(filepath):
            return False

        try:
            doc = fitz.open(filepath)
            is_encrypted = doc.needs_pass
            doc.close()
            return is_encrypted
        except Exception:
            return False

    @staticmethod
    def compression_target_valid(target_bytes: int, current_bytes: int) -> bool:
        """True only if target is at least 10% less than current."""
        return target_bytes <= (current_bytes * 0.9)

    @staticmethod
    def get_rejected_files(file_list: List[str]) -> List[str]:
        """Returns filenames (not full paths) that are unsupported types."""
        return [os.path.basename(f) for f in file_list if not Validators.is_supported_file(f)]

    @staticmethod
    def is_unc_path(path: str) -> bool:
        """Returns True for UNC network paths or Windows device namespace paths."""
        if not isinstance(path, str):
            return True
        trimmed = path.strip()
        return (
            trimmed.startswith("\\\\")
            or trimmed.startswith("//")
            or trimmed.startswith("\\?")
            or trimmed.startswith("/?")
            or trimmed.startswith("\\.")
            or trimmed.startswith("/.")
        )

    @staticmethod
    def has_traversal_segments(path: str) -> bool:
        """Returns True if path contains null bytes or '..' traversal segments."""
        if not isinstance(path, str) or "\x00" in path:
            return True
        parts = re.split(r"[/\\]", path)
        return any(part == ".." for part in parts)

    @staticmethod
    def validate_local_path(
        path: str,
        *,
        must_exist: bool = False,
        expect_dir: bool = False,
        expect_file: bool = False,
    ) -> str:
        """Validates a local filesystem path, blocking UNC paths, null bytes, and traversal."""
        if not isinstance(path, str) or not path.strip():
            raise ValueError("Invalid path: path must be a non-empty string.")
        if Validators.is_unc_path(path):
            raise ValueError("Network/UNC and device paths are not permitted.")
        if Validators.has_traversal_segments(path):
            raise ValueError("Path traversal segments ('..') and null bytes are not permitted.")

        resolved = os.path.realpath(os.path.abspath(path.strip()))
        if Validators.is_unc_path(resolved):
            raise ValueError("Resolved path points to a restricted network/UNC location.")

        if must_exist and not os.path.exists(resolved):
            raise ValueError("The requested local path does not exist.")
        if expect_dir and not os.path.isdir(resolved):
            raise ValueError("The requested path is not a valid local directory.")
        if expect_file and not os.path.isfile(resolved):
            raise ValueError("The requested path is not a valid local file.")

        return resolved

    @staticmethod
    def is_path_within(child_path: str, allowed_parent: str) -> bool:
        """Returns True if child_path resolves inside (or equal to) allowed_parent."""
        try:
            real_child = os.path.realpath(os.path.abspath(child_path))
            real_parent = os.path.realpath(os.path.abspath(allowed_parent))
            return os.path.commonpath([real_parent, real_child]) == real_parent
        except ValueError:
            # Different drives on Windows raise ValueError in commonpath
            return False

    @staticmethod
    def sanitize_filename_stem(stem: str, fallback: str = "document") -> str:
        """
        Sanitizes a filename stem against path traversal, illegal characters,
        and Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
        """
        if not isinstance(stem, str):
            return fallback
        # Strip any path prefix regardless of platform separator
        base = re.split(r"[/\\]", stem)[-1]
        cleaned = _ILLEGAL_FILENAME_CHARS_RE.sub("_", base)
        cleaned = cleaned.replace("..", "_")
        cleaned = cleaned.strip(" .")
        cleaned = cleaned[:120].strip(" .")

        if not cleaned:
            return fallback

        # Windows treats reserved names with ANY trailing dot/extension as device files (e.g. CON.pdf, NUL.1)
        head = cleaned.split(".", 1)[0].upper()
        if head in WINDOWS_RESERVED_NAMES:
            cleaned = f"file_{cleaned}"

        return cleaned

    @staticmethod
    def sanitize_filename(filename: str, fallback_stem: str = "file") -> str:
        """Sanitizes a full filename (stem + safe extension), handling reserved names and traversal."""
        if not isinstance(filename, str) or not filename.strip():
            return fallback_stem
        base = re.split(r"[/\\]", filename.strip())[-1]
        raw_stem, raw_ext = os.path.splitext(base)
        safe_stem = Validators.sanitize_filename_stem(raw_stem, fallback=fallback_stem)
        safe_ext = raw_ext.lower() if _SAFE_EXT_RE.match(raw_ext) else ""
        return f"{safe_stem}{safe_ext}"

    @staticmethod
    def is_allowed_external_url(url: str) -> bool:
        """
        Strict external URL allowlist for opening links from the Desktop app.
        Permits only https://github.com/kamal-hq/DeskConvert (and subpaths).
        """
        if not isinstance(url, str):
            return False
        raw = url.strip()
        if not raw or any(ch.isspace() or ord(ch) < 32 for ch in raw) or "\\" in raw:
            return False
        try:
            parsed = urlsplit(raw)
        except Exception:
            return False

        if parsed.scheme != "https":
            return False
        if parsed.username is not None or parsed.password is not None or parsed.port is not None:
            return False
        if (parsed.hostname or "").lower() != ALLOWED_EXTERNAL_HOST:
            return False

        path = parsed.path or ""
        if ".." in path.split("/"):
            return False

        return path == ALLOWED_EXTERNAL_PATH_PREFIX or path.startswith(
            f"{ALLOWED_EXTERNAL_PATH_PREFIX}/"
        )

    @staticmethod
    def validate_file_size(
        filepath: str,
        max_bytes: int = MAX_DESKTOP_FILE_BYTES,
        display_name: str | None = None,
    ) -> int:
        """Checks file size against the safety cap and returns the byte count."""
        size = os.path.getsize(filepath)
        if size > max_bytes:
            label = display_name or os.path.basename(filepath)
            limit_mb = max_bytes // (1024 * 1024)
            raise ValueError(
                f"File '{label}' exceeds the {limit_mb} MB safety cap and was blocked to prevent memory exhaustion."
            )
        return size

    @staticmethod
    def validate_image_safety(
        filepath: str,
        max_pixels: int = MAX_IMAGE_PIXELS,
        display_name: str | None = None,
    ) -> tuple[int, int]:
        """Inspects image header dimensions before decoding to block decompression bombs."""
        label = display_name or os.path.basename(filepath)
        prev_limit = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = max_pixels
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(filepath) as img:
                    w, h = img.size
            if w <= 0 or h <= 0:
                raise ValueError(f"Image '{label}' has invalid dimensions ({w}x{h}).")
            if w * h > max_pixels:
                mp = round(max_pixels / 1_000_000)
                raise ValueError(
                    f"Image '{label}' ({w}x{h}) exceeds the {mp} MP decompression-bomb safety cap."
                )
            return w, h
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            mp = round(max_pixels / 1_000_000)
            raise ValueError(
                f"Image '{label}' exceeds the {mp} MP decompression-bomb safety cap and was blocked."
            ) from None
        finally:
            Image.MAX_IMAGE_PIXELS = prev_limit

    @staticmethod
    def validate_pdf_safety(
        filepath: str,
        max_pages: int = MAX_DESKTOP_PDF_PAGES,
        display_name: str | None = None,
    ) -> int:
        """Validates PDF page count against the safety cap and returns page count."""
        label = display_name or os.path.basename(filepath)
        with fitz.open(filepath) as doc:
            page_count = len(doc)
        if page_count > max_pages:
            raise ValueError(
                f"PDF '{label}' has {page_count} pages, exceeding the {max_pages}-page safety cap."
            )
        return page_count

    @staticmethod
    def validate_render_pixmap_size(
        width_pt: float,
        height_pt: float,
        dpi: float,
        max_pixels: int = MAX_RENDER_PIXELS,
    ) -> None:
        """Blocks rasterizing abnormally huge PDF pages at high DPI to prevent OOM."""
        scale = max(0.1, float(dpi)) / 72.0
        est_w = max(1, int(round(width_pt * scale)))
        est_h = max(1, int(round(height_pt * scale)))
        if est_w * est_h > max_pixels:
            mp = round(max_pixels / 1_000_000)
            raise ValueError(
                f"Rendering this page at {int(dpi)} DPI ({est_w}x{est_h} px) exceeds the {mp} MP memory safety cap. Choose a lower DPI."
            )
