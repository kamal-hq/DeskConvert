import base64
import os
import pymupdf as fitz
from PIL import Image

from desktop.bridge import DeskConvertBridge
from utils.settings import SettingsManager


def _make_pdf(path: str, pages: int = 2) -> None:
    with fitz.open() as doc:
        for i in range(pages):
            p = doc.new_page(width=300, height=400)
            p.insert_text((40, 60), f"Bridge Page {i + 1}", fontsize=16)
        doc.save(path)


def test_desktop_bridge_workflows(tmp_path):
    out_dir = tmp_path / "exports"
    out_dir.mkdir()
    cfg = str(tmp_path / "settings.json")

    bridge = DeskConvertBridge()
    bridge.settings = SettingsManager(config_path=cfg)
    bridge.history.settings = bridge.settings
    bridge.settings.set_default_output_directory(str(out_dir))
    bridge.settings.set_quick_save_enabled(True)

    pdf_path = str(tmp_path / "sample.pdf")
    _make_pdf(pdf_path, pages=2)
    img_path = str(tmp_path / "pic.png")
    Image.new("RGB", (200, 150), (80, 130, 170)).save(img_path)
    (tmp_path / "ignore.txt").write_text("unsupported")

    try:
        staged = bridge.stage_paths([pdf_path, img_path, str(tmp_path / "ignore.txt")])
        assert len(staged["items"]) == 3
        assert staged["rejected"] == ["ignore.txt"]

        preview_url = bridge.get_full_res_preview(staged["items"][0]["sourceId"], 0)
        assert preview_url.startswith("data:image/png;base64,")

        # Export reordered storyboard (page 2, image, page 1) to merged PDF
        reordered = [
            {"sourceId": staged["items"][1]["sourceId"], "pageIndex": 1},
            {"sourceId": staged["items"][2]["sourceId"], "pageIndex": 0},
            {"sourceId": staged["items"][0]["sourceId"], "pageIndex": 0},
        ]
        merged = bridge.merge_files({
            "items": reordered,
            "watermarkEnabled": True,
            "metadataAction": "strip",
            "compressionBytes": None,
        })
        assert merged is not None
        assert os.path.isfile(merged["artifacts"][0]["savedPath"])

        # Export PDF pages to PNG
        imgs_out = bridge.export_pdf_to_images({
            "items": [reordered[0], reordered[2]],
            "format": "PNG",
            "dpi": 72,
            "watermarkEnabled": False,
            "metadataAction": "keep",
        })
        assert imgs_out is not None
        assert imgs_out["outputCount"] == 2

        # Split individual
        split_out = bridge.split_pdf({
            "items": reordered,
            "ranges": [{"id": "r1", "from": 1, "to": 2}],
            "mode": "individual",
            "watermarkEnabled": True,
            "metadataAction": "keep",
        })
        assert split_out is not None
        assert split_out["outputCount"] == 2

        # Upload drop simulation via base64
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        dropped = bridge.stage_uploaded_files([{"name": "dropped.png", "base64": b64}])
        assert len(dropped["items"]) == 1

        batch_out = bridge.batch_convert_images({
            "items": [{"sourceId": dropped["items"][0]["sourceId"], "pageIndex": 0}],
            "format": "WEBP",
            "watermarkEnabled": True,
            "metadataAction": "strip",
        })
        assert batch_out is not None
        assert batch_out["artifacts"][0]["fileName"].endswith(".webp")
    finally:
        bridge.cleanup()
