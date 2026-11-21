import os
from typing import List, Optional, Tuple
from PIL import Image

from core.export import ExportEngine
from core.metadata import keep_metadata, strip_metadata
from core.watermark import apply_watermark


class ImageEngine:
    """Core engine for converting and processing images via Pillow."""

    @staticmethod
    def convert_image(
        cached_source_path: str,
        output_folder: str,
        target_format: str,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
        safe_naming: bool = True,
        stem_override: Optional[str] = None,
    ) -> str:
        """
        Converts single image to target_format into output_folder.
        Preserves or strips metadata and applies watermark cleanly without overwriting outputs.
        """
        os.makedirs(output_folder, exist_ok=True)
        filename = os.path.basename(cached_source_path)
        base, _ = os.path.splitext(filename)
        stem = stem_override or base

        ext = target_format.lower().lstrip(".")
        pil_format = ext.upper()
        if ext in ("jpg", "jpeg"):
            ext = "jpg"
            pil_format = "JPEG"
        elif ext in ("tif", "tiff"):
            ext = "tiff"
            pil_format = "TIFF"

        if safe_naming:
            out_path = ExportEngine.safe_output_path(output_folder, stem, f".{ext}")
        else:
            out_path = os.path.join(output_folder, f"{stem}.{ext}")

        with Image.open(cached_source_path) as img:
            exif_bytes = img.info.get("exif") if metadata_action == "keep" else None

            if pil_format in ("JPEG", "BMP") and img.mode in ("RGBA", "LA", "P", "CMYK"):
                if img.mode == "CMYK":
                    img = img.convert("RGB")
                else:
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    background = Image.new("RGB", img.size, (255, 255, 255))
                    if img.mode in ("RGBA", "LA"):
                        background.paste(img, mask=img.split()[-1])
                    else:
                        background.paste(img)
                    img = background
            elif img.mode == "P" and pil_format not in ("PNG", "GIF"):
                img = img.convert("RGB")

            save_kwargs = {"format": pil_format}
            if exif_bytes and pil_format in ("JPEG", "PNG", "WEBP", "TIFF"):
                save_kwargs["exif"] = exif_bytes
            img.save(out_path, **save_kwargs)

        if watermark_enabled:
            apply_watermark(out_path)
        if metadata_action == "strip":
            strip_metadata(out_path)
        elif metadata_action == "keep":
            keep_metadata(cached_source_path, out_path)

        return out_path

    @staticmethod
    def batch_convert(
        cached_source_paths: List[str],
        output_folder: str,
        target_format: str,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
    ) -> List[str]:
        """Converts multiple images safely without filename collisions."""
        return [
            ImageEngine.convert_image(
                p,
                output_folder,
                target_format,
                watermark_enabled=watermark_enabled,
                metadata_action=metadata_action,
                safe_naming=True,
            )
            for p in cached_source_paths
        ]

    @staticmethod
    def get_image_size_bytes(filepath: str) -> int:
        return os.path.getsize(filepath)

    @staticmethod
    def get_image_dimensions(filepath: str) -> Tuple[int, int]:
        with Image.open(filepath) as img:
            return img.size
