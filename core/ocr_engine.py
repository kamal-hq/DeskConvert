import os
import shutil
import sys
from typing import List, Optional

import pymupdf as fitz
import pytesseract
from pdf2image import convert_from_path
from PIL import Image

from utils.validators import MAX_IMAGE_PIXELS, Validators

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


def _discover_tesseract() -> Optional[str]:
    if shutil.which("tesseract"):
        return shutil.which("tesseract")

    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "tesseract", "tesseract.exe"))
        candidates.append(os.path.join(exe_dir, "Tesseract-OCR", "tesseract.exe"))
    candidates.extend([
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ])
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def _discover_poppler() -> Optional[str]:
    if shutil.which("pdftoppm"):
        return os.path.dirname(shutil.which("pdftoppm"))

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "poppler", "bin"))
    candidates.extend([
        os.path.join(repo_root, "installer_assets", "poppler", "bin"),
        r"C:\Program Files\DeskConvert\poppler\bin",
    ])
    for folder in candidates:
        if os.path.isfile(os.path.join(folder, "pdftoppm.exe")) or os.path.isfile(
            os.path.join(folder, "pdftoppm")
        ):
            return folder
    return None


class OcrEngine:
    """Core engine for OCR extraction via Tesseract & Poppler (supports PDFs & images)."""

    @staticmethod
    def _configure_tesseract() -> None:
        cmd = _discover_tesseract()
        if cmd:
            pytesseract.pytesseract.tesseract_cmd = cmd
        try:
            pytesseract.get_tesseract_version()
        except Exception:
            raise RuntimeError(
                "Tesseract OCR is not installed or not found. Please install Tesseract or add it to PATH."
            )

    @staticmethod
    def _load_pages_as_images(cached_path: str) -> List[Image.Image]:
        ext = os.path.splitext(cached_path)[1].lower()
        if ext in IMAGE_EXTS:
            Validators.validate_image_safety(cached_path)
            return [Image.open(cached_path).convert("RGB")]
        Validators.validate_pdf_safety(cached_path)

        poppler_path = _discover_poppler()
        try:
            kwargs = {"poppler_path": poppler_path} if poppler_path else {}
            return convert_from_path(cached_path, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            if "poppler" in msg or "not installed" in msg or "unable to get page count" in msg:
                # Fallback to PyMuPDF rasterization so OCR still works cleanly even without Poppler!
                images: List[Image.Image] = []
                with fitz.open(cached_path) as doc:
                    for page in doc:
                        pix = page.get_pixmap(dpi=250, alpha=False)
                        images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
                return images
            raise

    @staticmethod
    def to_searchable_pdf(cached_path: str, output_path: str) -> str:
        """Converts scanned PDF or image to a searchable PDF with invisible OCR text layer."""
        OcrEngine._configure_tesseract()
        images = OcrEngine._load_pages_as_images(cached_path)
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        with fitz.open() as merged_doc:
            for img in images:
                pdf_page_bytes = pytesseract.image_to_pdf_or_hocr(img, extension="pdf")
                with fitz.open("pdf", pdf_page_bytes) as doc:
                    merged_doc.insert_pdf(doc)
            merged_doc.save(output_path)

        return output_path

    @staticmethod
    def to_text_file(cached_path: str, output_path: str) -> str:
        """Extracts text from PDF or image into a UTF-8 .txt file."""
        OcrEngine._configure_tesseract()
        images = OcrEngine._load_pages_as_images(cached_path)
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        with open(output_path, "w", encoding="utf-8") as f:
            for i, img in enumerate(images, start=1):
                text = pytesseract.image_to_string(img)
                f.write(f"--- Page {i} ---\n")
                f.write(text)
                f.write("\n\n")

        return output_path
