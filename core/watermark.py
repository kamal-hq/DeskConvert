import os
import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont


class WatermarkEngine:
    """Core engine for applying subtle DeskConvert branding watermarks to PDFs and images."""

    TEXT = "DeskConvert | Made by Muhammad Kamal"
    FONT_SIZE = 8
    COLOR = (170, 170, 170)
    MARGIN = 10
    OPACITY = 0.3

    @staticmethod
    def apply_to_pdf(pdf_path: str) -> None:
        with fitz.open(pdf_path) as doc:
            color = tuple(c / 255.0 for c in WatermarkEngine.COLOR)
            for page in doc:
                rect = page.rect
                tw = fitz.get_text_length(
                    WatermarkEngine.TEXT, fontname="helv", fontsize=WatermarkEngine.FONT_SIZE
                )
                x = max(WatermarkEngine.MARGIN, rect.width - tw - WatermarkEngine.MARGIN)
                y = rect.height - WatermarkEngine.MARGIN
                page.insert_text(
                    fitz.Point(x, y),
                    WatermarkEngine.TEXT,
                    fontname="helv",
                    fontsize=WatermarkEngine.FONT_SIZE,
                    color=color,
                    fill_opacity=WatermarkEngine.OPACITY,
                )
            temp_path = pdf_path + ".tmp"
            doc.save(temp_path)
        os.replace(temp_path, pdf_path)

    @staticmethod
    def apply_to_image(image_path: str) -> None:
        ext = os.path.splitext(image_path)[1].lower()
        with Image.open(image_path) as raw_img:
            original_mode = raw_img.mode
            exif = raw_img.info.get("exif")
            img = raw_img.convert("RGBA") if raw_img.mode != "RGBA" else raw_img.copy()

        overlay = Image.new("RGBA", img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)
        try:
            font = ImageFont.truetype("arial.ttf", max(11, int(img.width * 0.015)))
        except IOError:
            font = ImageFont.load_default()

        left, top, right, bottom = draw.textbbox((0, 0), WatermarkEngine.TEXT, font=font)
        tw, th = right - left, bottom - top
        x = max(WatermarkEngine.MARGIN, img.width - tw - WatermarkEngine.MARGIN)
        y = max(WatermarkEngine.MARGIN, img.height - th - WatermarkEngine.MARGIN)
        fill_color = WatermarkEngine.COLOR + (int(255 * WatermarkEngine.OPACITY),)
        draw.text((x, y), WatermarkEngine.TEXT, font=font, fill=fill_color)

        watermarked = Image.alpha_composite(img, overlay)
        if ext in (".jpg", ".jpeg", ".bmp") or original_mode in ("RGB", "P", "L", "CMYK"):
            bg = Image.new("RGB", watermarked.size, (255, 255, 255))
            bg.paste(watermarked, mask=watermarked.split()[3])
            watermarked = bg
            if original_mode == "P" and ext not in (".jpg", ".jpeg", ".bmp"):
                watermarked = watermarked.quantize()
        elif original_mode != "RGBA":
            watermarked = watermarked.convert(original_mode)

        save_kwargs = {}
        if exif and ext in (".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"):
            save_kwargs["exif"] = exif
        watermarked.save(image_path, **save_kwargs)

    @staticmethod
    def apply(file_path: str) -> None:
        _, ext = os.path.splitext(file_path)
        if ext.lower() == ".pdf":
            WatermarkEngine.apply_to_pdf(file_path)
        else:
            WatermarkEngine.apply_to_image(file_path)


apply_watermark = WatermarkEngine.apply
