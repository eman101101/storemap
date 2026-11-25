#!/usr/bin/env python3
"""Packshot helpers for fetch-demo-photos-cc.mjs (needs Pillow).

Openly-licensed photos of an object are usually scene shots: the product sits
somewhere in a photo with a desk, a wall or a person around it. These helpers
turn such a photo into something that reads as a shelf facing.

    python3 packshot.py analyze <image> [<image>…]  # JSON packshot score(s)
    python3 packshot.py finish <in> <out.jpg> [--box x,y,w,h] [--max 440]

analyze   — how "product-photo" the image is: is the border one flat colour
            (studio backdrop or transparency), how much of the frame the
            product fills, and the product's bounding box.
finish    — flatten transparency onto the photo's own backdrop colour, crop to
            the product (plus a margin) when the backdrop is flat, and save a
            small JPEG. The planogram draws tiles uncropped, so a photo's own
            proportions are kept — nothing is stretched or cut to fit.
"""
import json
import sys

from PIL import Image

GRID_W = 72  # analysis runs on a small copy — exact pixels don't matter
BORDER_PX = 2  # ring of grid cells sampled as "background"
COLOR_TOL = 34  # RGB distance still counted as the backdrop colour
MIN_UNIFORM = 0.84  # border agreement needed before a photo may be cropped/padded


def dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def median(vals):
    vals = sorted(vals)
    n = len(vals)
    return vals[n // 2]


def analyze(path):
    im = Image.open(path)
    im = im.convert("RGBA")
    w, h = im.size
    gw = GRID_W
    gh = max(12, round(GRID_W * h / w))
    small = im.resize((gw, gh), Image.BILINEAR)
    px = small.load()

    border = []
    for x in range(gw):
        for y in list(range(BORDER_PX)) + list(range(gh - BORDER_PX, gh)):
            border.append(px[x, y])
    for y in range(gh):
        for x in list(range(BORDER_PX)) + list(range(gw - BORDER_PX, gw)):
            border.append(px[x, y])

    # a transparent backdrop composites onto white, like it will on the shelf
    transparent = sum(1 for p in border if p[3] < 40) / max(1, len(border))
    flat = [(p[0], p[1], p[2]) if p[3] >= 40 else (255, 255, 255) for p in border]
    bg = (median([c[0] for c in flat]), median([c[1] for c in flat]), median([c[2] for c in flat]))
    same = sum(1 for p in border if p[3] < 40 or dist((p[0], p[1], p[2]), bg) <= COLOR_TOL)
    uniform = same / max(1, len(border))
    light = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255

    # the product = interior cells that differ from the backdrop
    xs, ys, count = [], [], 0
    inner = 0
    for y in range(gh):
        for x in range(gw):
            if BORDER_PX <= x < gw - BORDER_PX and BORDER_PX <= y < gh - BORDER_PX:
                inner += 1
                r, g, b, a = px[x, y]
                if a >= 40 and dist((r, g, b), bg) > COLOR_TOL:
                    count += 1
                    xs.append(x)
                    ys.append(y)
    fill = count / max(1, inner)
    if xs:
        sx, sy = w / gw, h / gh
        box = [int(min(xs) * sx), int(min(ys) * sy), int((max(xs) + 1) * sx), int((max(ys) + 1) * sy)]
    else:
        box = [0, 0, w, h]
    return {
        "w": w, "h": h, "uniform": round(uniform, 3), "light": round(light, 3),
        "transparent": round(transparent, 3), "fill": round(fill, 3), "box": box,
    }


def finish(src, dst, box, max_px):
    """Crop to the product (plus a margin) when the backdrop is flat, else keep
    the whole photo; flatten transparency onto the photo's own backdrop colour
    and save as a small JPEG. Returns the saved size."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    small = im.resize((72, max(12, round(72 * h / w))), Image.BILINEAR)
    sp = small.load()
    sw, sh = small.size
    edge = [sp[i, j][:3] for i in range(sw) for j in (0, 1, sh - 2, sh - 1)]
    edge += [sp[i, j][:3] for j in range(sh) for i in (0, 1, sw - 2, sw - 1)]
    bgc = (median([c[0] for c in edge]), median([c[1] for c in edge]), median([c[2] for c in edge]), 255)
    flat = Image.new("RGBA", im.size, bgc)
    im = Image.alpha_composite(flat, im)
    info = analyze(src)
    if info["uniform"] >= MIN_UNIFORM and info["fill"] > 0.015:
        bx, by, bx2, by2 = box
        m = max(6, round(max(bx2 - bx, by2 - by) * 0.1))
        im = im.crop((max(0, bx - m), max(0, by - m), min(w, bx2 + m), min(h, by2 + m)))
    if max(im.size) > max_px:
        k = max_px / max(im.size)
        im = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
    im.convert("RGB").save(dst, "JPEG", quality=82, optimize=True, progressive=True)
    return im.size


def main(argv):
    if len(argv) >= 3 and argv[1] == "analyze":
        # several files at once → a JSON list (one process for a whole batch)
        results = [analyze(p) for p in argv[2:]]
        print(json.dumps(results[0] if len(results) == 1 else results))
        return 0
    if len(argv) >= 4 and argv[1] == "finish":
        opt = lambda flag: argv[argv.index(flag) + 1] if flag in argv else None  # noqa: E731
        box = [int(v) for v in opt("--box").split(",")] if opt("--box") else analyze(argv[2])["box"]
        max_px = int(opt("--max") or 440)
        size = finish(argv[2], argv[3], box, max_px)
        print(json.dumps({"w": size[0], "h": size[1]}))
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
