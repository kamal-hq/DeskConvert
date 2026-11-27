import io
import os
import pymupdf as fitz
from PIL import Image

from core.metadata import keep_metadata, strip_metadata
from core.watermark import apply_watermark
from utils.validators import MAX_IMAGE_PIXELS, Validators

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class CompressionEngine:
    """Core engine for compressing PDFs and images with target-size control."""

    @staticmethod
    def analyze(cached_file_path: str, target_bytes: int) -> dict:
        """Analyzes size difference and estimates quality heuristics."""
        current_size = os.path.getsize(cached_file_path)
        if target_bytes >= current_size:
            raise ValueError("Target size must be less than current file size.")

        reduction_percent = ((current_size - target_bytes) / current_size) * 100.0
        suggested_quality = max(10, int(100 - reduction_percent))
        estimated_output = int(current_size * (suggested_quality / 100.0))

        return {
            "current_size_bytes": current_size,
            "target_size_bytes": target_bytes,
            "suggested_quality": suggested_quality,
            "estimated_output_bytes": estimated_output,
            "reduction_percent": round(reduction_percent, 2),
        }

    @staticmethod
    def compress_image(
        cached_source_path: str,
        output_path: str,
        target_bytes: int,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
    ) -> str:
        """Uses binary search (JPEG/WEBP) or palette/scale optimization (PNG) to hit target_bytes."""
        current_size = os.path.getsize(cached_source_path)
        if target_bytes >= current_size:
            raise ValueError("Target size must be less than current file size.")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        _, ext = os.path.splitext(output_path)
        ext = ext.lower()

        save_format = "JPEG"
        if ext == ".webp":
            save_format = "WEBP"
        elif ext in (".png", ".bmp", ".tiff", ".tif"):
            save_format = "TIFF" if ext in (".tif", ".tiff") else ext.lstrip(".").upper()

        Validators.validate_image_safety(cached_source_path)
        with Image.open(cached_source_path) as raw_img:
            img = raw_img.copy()
            exif_bytes = raw_img.info.get("exif") if metadata_action == "keep" else None

            if save_format == "JPEG" and img.mode in ("RGBA", "P", "LA", "CMYK"):
                if img.mode == "CMYK":
                    img = img.convert("RGB")
                else:
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    bg = Image.new("RGB", img.size, (255, 255, 255))
                    if img.mode in ("RGBA", "LA"):
                        bg.paste(img, mask=img.split()[-1])
                    else:
                        bg.paste(img)
                    img = bg
            elif img.mode == "P" and save_format not in ("PNG", "GIF"):
                img = img.convert("RGB")

            if save_format in ("JPEG", "WEBP"):
                low, high = 5, 95
                best_bytes = None
                while low <= high:
                    mid = (low + high) // 2
                    buf = io.BytesIO()
                    kwargs = {"format": save_format, "quality": mid}
                    if save_format == "JPEG":
                        kwargs["optimize"] = True
                    if exif_bytes:
                        kwargs["exif"] = exif_bytes
                    img.save(buf, **kwargs)
                    if buf.tell() <= target_bytes:
                        best_bytes = buf.getvalue()
                        low = mid + 1
                    else:
                        high = mid - 1

                if best_bytes:
                    with open(output_path, "wb") as f:
                        f.write(best_bytes)
                else:
                    kwargs = {"format": save_format, "quality": 5}
                    if save_format == "JPEG":
                        kwargs["optimize"] = True
                    img.save(output_path, **kwargs)
            elif save_format == "PNG":
                # Try optimize=True, then palette quantization, then gentle downscaling
                best_bytes = None
                for candidate in (
                    img,
                    img.convert("RGB").quantize(colors=256),
                    img.convert("RGB").quantize(colors=128),
                    img.convert("RGB").quantize(colors=64),
                ):
                    buf = io.BytesIO()
                    candidate.save(buf, format="PNG", optimize=True)
                    best_bytes = buf.getvalue()
                    if len(best_bytes) <= target_bytes:
                        break
                if len(best_bytes) > target_bytes:
                    for scale in (0.85, 0.7, 0.55, 0.4):
                        nw = max(32, int(img.width * scale))
                        nh = max(32, int(img.height * scale))
                        scaled = img.resize((nw, nh), Image.Resampling.LANCZOS)
                        buf = io.BytesIO()
                        scaled.convert("RGB").quantize(colors=128).save(
                            buf, format="PNG", optimize=True
                        )
                        best_bytes = buf.getvalue()
                        if len(best_bytes) <= target_bytes:
                            break
                with open(output_path, "wb") as f:
                    f.write(best_bytes)
            else:
                img.save(output_path, format=save_format)

        if watermark_enabled:
            apply_watermark(output_path)
        if metadata_action == "strip":
            strip_metadata(output_path)
        elif metadata_action == "keep":
            keep_metadata(cached_source_path, output_path)

        return output_path

    @staticmethod
    def compress_pdf(
        cached_source_path: str,
        output_path: str,
        target_bytes: int,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
    ) -> str:
        """
        Compresses PDF first via lossless object/stream cleanup, and if still over target_bytes,
        adaptively downsamples/JPEG-recompresses pages inside PyMuPDF to hit the target size.
        """
        current_size = os.path.getsize(cached_source_path)
        if target_bytes >= current_size:
            raise ValueError("Target size must be less than current file size.")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with fitz.open(cached_source_path) as doc:
            doc.save(output_path, garbage=4, deflate=True, clean=True)

        if os.path.getsize(output_path) > target_bytes:
            best_pdf_bytes = open(output_path, "rb").read()
            # Adaptive fallback ladder from crisp (150 DPI q=78) down to aggressive (72 DPI q=28)
            attempts = [
                (150, 78),
                (120, 68),
                (96, 55),
                (72, 45),
                (72, 30),
            ]
            with fitz.open(cached_source_path) as src_doc:
                for dpi, quality in attempts:
                    with fitz.open() as re_doc:
                        for page in src_doc:
                            pix = page.get_pixmap(dpi=dpi, alpha=False)
                            pil_img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                            jpg_buf = io.BytesIO()
                            pil_img.save(jpg_buf, format="JPEG", quality=quality, optimize=True)
                            new_page = re_doc.new_page(
                                width=page.rect.width, height=page.rect.height
                            )
                            new_page.insert_image(new_page.rect, stream=jpg_buf.getvalue())
                        cand_bytes = re_doc.tobytes(garbage=4, deflate=True, clean=True)
                    if len(cand_bytes) < len(best_pdf_bytes):
                        best_pdf_bytes = cand_bytes
                    if len(cand_bytes) <= target_bytes:
                        best_pdf_bytes = cand_bytes
                        break

            with open(output_path, "wb") as f:
                f.write(best_pdf_bytes)

        if watermark_enabled:
            apply_watermark(output_path)
        if metadata_action == "strip":
            strip_metadata(output_path)
        elif metadata_action == "keep":
            keep_metadata(cached_source_path, output_path)

        return output_path

    @staticmethod
    def compress(
        cached_source_path: str,
        output_path: str,
        target_bytes: int,
        watermark_enabled: bool = False,
        metadata_action: str = "keep",
    ) -> str:
        """Detects file type and routes to the matching compression method."""
        _, ext = os.path.splitext(cached_source_path)
        if ext.lower() == ".pdf":
            return CompressionEngine.compress_pdf(
                cached_source_path,
                output_path,
                target_bytes,
                watermark_enabled=watermark_enabled,
                metadata_action=metadata_action,
            )
        return CompressionEngine.compress_image(
            cached_source_path,
            output_path,
            target_bytes,
            watermark_enabled=watermark_enabled,
            metadata_action=metadata_action,
        )
