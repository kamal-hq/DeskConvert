import os
from PIL import Image, ImageDraw


def generate_icons(src_preview: str, assets_dir: str, public_dir: str) -> None:
    os.makedirs(assets_dir, exist_ok=True)
    os.makedirs(public_dir, exist_ok=True)

    img = Image.open(src_preview).convert("RGBA")
    box = (101, 101, 923, 923)
    cropped = img.crop(box)
    cw, ch = cropped.size

    scale = 4
    mw, mh = cw * scale, ch * scale
    mask = Image.new("L", (mw, mh), 0)
    draw = ImageDraw.Draw(mask)
    inset = 2 * scale
    radius = 186 * scale
    draw.rounded_rectangle([inset, inset, mw - 1 - inset, mh - 1 - inset], radius=radius, fill=255)
    mask = mask.resize((cw, ch), Image.Resampling.LANCZOS)
    cropped.putalpha(mask)

    master = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    squircle = cropped.resize((900, 900), Image.Resampling.LANCZOS)
    master.paste(squircle, (62, 62), squircle)

    master.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(assets_dir, "icon.png"), "PNG")
    master.save(
        os.path.join(assets_dir, "icon.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    master.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "favicon.png"), "PNG")
    master.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "apple-touch-icon.png"), "PNG")
    master.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "icon-192.png"), "PNG")
    master.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "icon-512.png"), "PNG")


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "new_icon_preview.png")
    generate_icons(src, os.path.join(root, "assets"), os.path.join(root, "public"))
    print("Generated assets/icon.ico, assets/icon.png, and public/ web icons.")
