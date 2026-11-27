import os
import re
from typing import List
from urllib.parse import urlsplit

import pymupdf as fitz  # PyMuPDF

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
