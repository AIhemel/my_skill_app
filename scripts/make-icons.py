"""Render the legacy (pre-Android 8) launcher icons and the web favicon.

Run from the repo root:  python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
TOP_LEFT = (0x6D, 0x28, 0xD9)
BOTTOM_RIGHT = (0x0E, 0xA5, 0xE9)
BOLT = [(59, 30), (37, 58), (52, 58), (49, 80), (72, 50), (57, 50)]
SPARK = [(76, 30), (78, 35), (83, 37), (78, 39), (76, 44), (74, 39), (69, 37), (74, 35)]


def render(size, round_mask=False):
    scale = 4  # supersample, then downscale for smooth edges
    n = size * scale
    grad = Image.new("RGB", (n, n))
    px = grad.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    if round_mask:
        md.ellipse((0, 0, n - 1, n - 1), fill=255)
    else:
        md.rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * 0.22), fill=255)
    icon = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(icon)
    # The vector art is drawn on a 108-unit canvas with a 66-unit safe zone;
    # map that safe zone (21..87) onto most of the legacy icon.
    def tx(pts):
        return [((x - 21) / 66 * n * 0.92 + n * 0.04, (y - 21) / 66 * n * 0.92 + n * 0.04) for x, y in pts]
    d.polygon(tx(BOLT), fill=(255, 255, 255, 255))
    d.polygon(tx(SPARK), fill=(0xFD, 0xE6, 0x8A, 255))
    return icon.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for dpi, size in SIZES.items():
        import os
        folder = f"android/res/mipmap-{dpi}"
        os.makedirs(folder, exist_ok=True)
        render(size).save(f"{folder}/ic_launcher.png")
    render(192).save("web/img/icon-192.png")
    render(512).save("web/img/icon-512.png")
    print("icons written")
