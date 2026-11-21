import os
import pymupdf as fitz
from PIL import Image


class MetadataEngine:
    """Core engine for preserving or scrubbing metadata from files."""

    @staticmethod
    def keep_metadata(source_cached_path: str, output_path: str) -> None:
        if not source_cached_path or not os.path.exists(source_cached_path):
            return

        ext_out = os.path.splitext(output_path)[1].lower()
        ext_src = os.path.splitext(source_cached_path)[1].lower()

        if ext_out == ".pdf" and ext_src == ".pdf":
            with fitz.open(source_cached_path) as src_doc, fitz.open(output_path) as out_doc:
                if src_doc.metadata:
                    out_doc.set_metadata(src_doc.metadata)
                    temp_path = output_path + ".tmp"
                    out_doc.save(temp_path)
                else:
                    return
            os.replace(temp_path, output_path)
        elif ext_out in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"} and ext_src in {
            ".jpg",
            ".jpeg",
            ".png",
            ".tiff",
            ".tif",
            ".webp",
        }:
            with Image.open(source_cached_path) as src_img:
                exif = src_img.info.get("exif")
            if exif:
                with Image.open(output_path) as out_img:
                    clean_copy = out_img.copy()
                clean_copy.save(output_path, exif=exif)

    @staticmethod
    def strip_metadata(output_path: str) -> None:
        ext = os.path.splitext(output_path)[1].lower()
        if ext == ".pdf":
            with fitz.open(output_path) as doc:
                doc.set_metadata({
                    "format": "",
                    "title": "",
                    "author": "",
                    "subject": "",
                    "keywords": "",
                    "creator": "",
                    "producer": "",
                    "creationDate": "",
                    "modDate": "",
                    "trapped": "",
                })
                temp_path = output_path + ".tmp"
                doc.save(temp_path)
            os.replace(temp_path, output_path)
        else:
            with Image.open(output_path) as img:
                img_clean = Image.new(img.mode, img.size)
                img_clean.paste(img)
                if img.mode == "P":
                    palette = img.getpalette()
                    if palette:
                        img_clean.putpalette(palette)
                save_kwargs = {}
                if "transparency" in img.info:
                    save_kwargs["transparency"] = img.info["transparency"]
                img_clean.save(output_path, **save_kwargs)


strip_metadata = MetadataEngine.strip_metadata
keep_metadata = MetadataEngine.keep_metadata
