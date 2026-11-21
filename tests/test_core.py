import os
import pymupdf as fitz
from PIL import Image

from core.cache_manager import CacheManager
from core.compression import CompressionEngine
from core.export import ExportEngine
from core.image_engine import ImageEngine
from core.metadata import MetadataEngine
from core.pdf_engine import PdfEngine
from core.watermark import WatermarkEngine
from utils.history import HistoryManager
from utils.settings import SettingsManager
from utils.validators import Validators


def _make_sample_pdf(path: str, pages: int = 3) -> None:
    with fitz.open() as doc:
        for i in range(pages):
            page = doc.new_page(width=400, height=500)
            page.insert_text((50, 80), f"DeskConvert Test Page {i + 1}", fontsize=18)
        doc.set_metadata({"title": "Secret Title", "author": "Test Author"})
        doc.save(path)


def _make_sample_image(path: str, color=(45, 95, 145), size=(320, 240)) -> None:
    img = Image.new("RGB", size, color)
    img.save(path)


def test_cache_manager_stage_render_and_cleanup(tmp_path):
    pdf_path = str(tmp_path / "sample.pdf")
    _make_sample_pdf(pdf_path, pages=2)

    cm = CacheManager()
    cached = cm.stage_file(pdf_path)
    assert os.path.isfile(cached)
    assert cached != pdf_path
    assert cm.get_page_count(cached) == 2

    thumb = cm.generate_thumbnail_bytes(cached, page_number=0)
    assert thumb.startswith(b"\x89PNG")
    full = cm.get_full_res_page_bytes(cached, page_number=1, dpi=100)
    assert full.startswith(b"\x89PNG")

    temp_dir = cm.temp_dir
    cm.clear_cache()
    assert not os.path.exists(temp_dir)


def test_pdf_engine_storyboard_merge_split_and_images(tmp_path):
    pdf_path = str(tmp_path / "doc.pdf")
    img_path = str(tmp_path / "pic.png")
    _make_sample_pdf(pdf_path, pages=3)
    _make_sample_image(img_path)

    # Reordered storyboard: page 2, image, page 0 (page 1 deleted)
    working_pdf = str(tmp_path / "working.pdf")
    PdfEngine.build_working_pdf([(pdf_path, 2), (img_path, 0), (pdf_path, 0)], working_pdf)
    assert PdfEngine.get_page_count(working_pdf) == 3

    # Split individual pages
    split_dir = str(tmp_path / "split_out")
    split_files = PdfEngine.split_pdf(
        working_pdf, [(1, 2)], "individual", split_dir, "doc", watermark_enabled=True, metadata_action="strip"
    )
    assert len(split_files) == 2
    with fitz.open(split_files[0]) as d:
        assert d.metadata.get("author", "") == ""

    # PDF to images
    img_dir = str(tmp_path / "img_out")
    img_files = PdfEngine.pdf_to_images(working_pdf, img_dir, "doc", dpi=72, fmt="png", page_indices=[0, 2])
    assert len(img_files) == 2
    assert all(os.path.isfile(p) for p in img_files)

    # Image to PDF
    out_pdf = str(tmp_path / "from_img.pdf")
    PdfEngine.image_to_pdf([img_path], out_pdf, watermark_enabled=True, metadata_action="strip")
    assert PdfEngine.get_page_count(out_pdf) == 1


def test_image_engine_safe_naming_and_batch(tmp_path):
    img1 = str(tmp_path / "a.png")
    img2 = str(tmp_path / "b.png")
    _make_sample_image(img1, color=(200, 80, 60))
    _make_sample_image(img2, color=(60, 180, 120))

    out_dir = str(tmp_path / "converted")
    first = ImageEngine.batch_convert([img1, img2], out_dir, "jpg", watermark_enabled=True, metadata_action="strip")
    second = ImageEngine.batch_convert([img1], out_dir, "jpg", watermark_enabled=False, metadata_action="keep")
    assert len(first) == 2
    assert all(os.path.isfile(p) for p in first)
    assert first[0] != second[0]  # Non-destructive safe naming prevents overwrite


def test_compression_image_and_pdf_target_bytes(tmp_path):
    # Textured image so JPEG compression drops cleanly below target
    noisy = Image.effect_noise((400, 400), 50).convert("RGB")
    jpg_in = str(tmp_path / "noisy.jpg")
    noisy.save(jpg_in, quality=95)
    orig_size = os.path.getsize(jpg_in)

    jpg_out = str(tmp_path / "noisy_small.jpg")
    CompressionEngine.compress(jpg_in, jpg_out, int(orig_size * 0.45))
    assert os.path.getsize(jpg_out) <= int(orig_size * 0.55)

    # PDF containing high-res image so adaptive PDF compression reduces size
    pdf_in = str(tmp_path / "heavy.pdf")
    with fitz.open() as doc:
        page = doc.new_page(width=400, height=400)
        page.insert_image(page.rect, filename=jpg_in)
        doc.save(pdf_in)
    pdf_orig = os.path.getsize(pdf_in)

    pdf_out = str(tmp_path / "light.pdf")
    CompressionEngine.compress(pdf_in, pdf_out, int(pdf_orig * 0.4))
    assert os.path.getsize(pdf_out) < pdf_orig


def test_settings_history_and_validators(tmp_path):
    cfg = str(tmp_path / "settings.json")
    s = SettingsManager(config_path=cfg)
    s.set_watermark_enabled(False)
    s.set_metadata_action("strip")
    s.set_theme("light")

    s2 = SettingsManager(config_path=cfg)
    assert s2.get_watermark_enabled() is False
    assert s2.get_metadata_action() == "strip"
    assert s2.get_theme() == "light"

    sample = str(tmp_path / "test.pdf")
    _make_sample_pdf(sample, pages=1)
    hm = HistoryManager(settings=s2)
    hm.add_entry(sample)
    detailed = hm.get_detailed_entries()
    assert len(detailed) == 1
    assert detailed[0]["exists"] is True
    assert detailed[0]["pageCount"] == 1

    assert Validators.is_supported_file(sample) is True
    assert Validators.compression_target_valid(80, 100) is True
    assert Validators.compression_target_valid(95, 100) is False
    assert os.path.basename(ExportEngine.safe_output_path(str(tmp_path), "doc", ".pdf")).startswith("doc_converted_")
