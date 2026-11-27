import os
from typing import Dict, List

from utils.validators import Validators


class ExportEngine:
    """Core engine for computing safe output paths and resolving target directories."""

    @staticmethod
    def _ensure_within_dir(directory: str, candidate_path: str) -> str:
        real_dir = os.path.realpath(os.path.abspath(directory))
        real_candidate = os.path.realpath(os.path.abspath(candidate_path))
        if os.path.commonpath([real_dir, real_candidate]) != real_dir:
            raise ValueError("Refused to write outside target output directory.")
        return candidate_path

    @staticmethod
    def safe_output_path(directory: str, stem: str, extension: str) -> str:
        """
        Returns path that won't overwrite existing files.
        Sanitizes stem against traversal/Windows reserved names and appends _converted_01, _converted_02, etc.
        """
        safe_dir = Validators.validate_local_path(directory)
        safe_stem = Validators.sanitize_filename_stem(stem, fallback="document")
        clean_ext = str(extension or "").strip().lstrip(".")
        clean_ext = "".join(ch for ch in clean_ext if ch.isalnum())[:8]
        ext = f".{clean_ext}" if clean_ext else ""

        counter = 1
        while True:
            filename = f"{safe_stem}_converted_{counter:02d}{ext}"
            full_path = ExportEngine._ensure_within_dir(safe_dir, os.path.join(safe_dir, filename))
            if not os.path.exists(full_path):
                return full_path
            counter += 1

    @staticmethod
    def get_default_directory(settings_manager) -> str:
        """Returns configured default output directory if set and exists. Otherwise returns user's Desktop path."""
        configured = settings_manager.get_default_output_directory()
        if configured:
            try:
                safe_cfg = Validators.validate_local_path(configured, must_exist=True, expect_dir=True)
                return safe_cfg
            except ValueError:
                pass

        # fallback to Desktop
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        if os.path.isdir(desktop):
            return desktop

        return os.path.expanduser("~")

    @staticmethod
    def batch_output_paths(directory: str, source_paths: List[str], target_extension: str) -> Dict[str, str]:
        """
        For each source path generates a safe output path in directory with target_extension.
        Returns {source_path: safe_output_path}
        """
        safe_dir = Validators.validate_local_path(directory)
        result = {}
        clean_ext = str(target_extension or "").strip().lstrip(".")
        clean_ext = "".join(ch for ch in clean_ext if ch.isalnum())[:8]
        ext = f".{clean_ext}" if clean_ext else ""

        for src in source_paths:
            filename = os.path.basename(src)
            raw_stem, _ = os.path.splitext(filename)
            safe_stem = Validators.sanitize_filename_stem(raw_stem, fallback="image")

            counter = 1
            while True:
                out_name = f"{safe_stem}_converted_{counter:02d}{ext}"
                out_path = ExportEngine._ensure_within_dir(safe_dir, os.path.join(safe_dir, out_name))

                # Check disk AND current batch result mapping to prevent collisions
                if not os.path.exists(out_path) and out_path not in result.values():
                    result[src] = out_path
                    break
                counter += 1

        return result
