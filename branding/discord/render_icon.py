"""Render the Rust Legacy Discord icon: a weathered, riveted radiation plate.

Usage: python render_icon.py   -> rust-legacy-icon.png (1024), rust-legacy-icon-512.png, _discord-preview.png
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

OUT = Path(__file__).parent
S = 1024           # output size
SS = 4             # supersampling for the vector parts
N = S * SS

# Site tokens (site/css/tokens.css): --k #0a0a0a, --or #cd5a28
INK = (14, 11, 10)
PLATE_LIT = (224, 108, 52)
PLATE_DARK = (178, 70, 29)
RUST = (92, 36, 15)
RUST_DEEP = (52, 21, 10)

R = 0.462          # plate radius, fraction of the canvas
C = 0.5


def fractal(seed, scales, weights):
    rng = np.random.default_rng(seed)
    acc = np.zeros((S, S))
    for sc, w in zip(scales, weights):
        g = rng.random((sc, sc)).astype(np.float32)
        acc += w * np.asarray(Image.fromarray(g).resize((S, S), Image.BICUBIC), float)
    return (acc - acc.min()) / (acc.max() - acc.min())


def disc_mask(radius):
    m = Image.new("L", (N, N), 0)
    ImageDraw.Draw(m).ellipse([(C - radius) * N, (C - radius) * N, (C + radius) * N, (C + radius) * N], fill=255)
    return m.resize((S, S), Image.LANCZOS)


def trefoil_mask():
    m = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(m)
    c, rp = C * N, R * N
    r_hub, r_in, r_out = rp * 0.150, rp * 0.235, rp * 0.790
    for centre in (30, 150, 270):  # standard orientation: one blade points down
        a0, a1 = math.radians(centre - 30), math.radians(centre + 30)
        steps = 90
        pts = [(c + r_in * math.cos(a0 + (a1 - a0) * i / steps), c - r_in * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]
        pts += [(c + r_out * math.cos(a1 - (a1 - a0) * i / steps), c - r_out * math.sin(a1 - (a1 - a0) * i / steps)) for i in range(steps + 1)]
        d.polygon(pts, fill=255)
    d.ellipse([c - r_hub, c - r_hub, c + r_hub, c + r_hub], fill=255)
    return m.resize((S, S), Image.LANCZOS)


def ring(radius, width):
    m = Image.new("L", (N, N), 0)
    rr = radius * N
    ImageDraw.Draw(m).ellipse([C * N - rr, C * N - rr, C * N + rr, C * N + rr], outline=255, width=max(1, int(width * N)))
    return m.resize((S, S), Image.LANCZOS)


def paint(img, mask, colour, alpha=1.0):
    a = np.asarray(mask, float)[..., None] / 255 * alpha
    return img * (1 - a) + np.array(colour, float) * a


def render():
    yy, xx = np.mgrid[0:S, 0:S].astype(float) + 0.5
    x, y = xx / S, yy / S
    r = np.hypot(x - C, y - C)

    # Ground: near-black with a faint warm lift behind the plate.
    k = np.clip(1 - r / 0.75, 0, 1) ** 2
    img = np.array((10, 10, 10), float) + np.array((14, 8, 5), float) * k[..., None]

    # Plate: lit from the upper left, with low-frequency grime.
    lit = np.clip(0.5 + ((C - x) * 0.8 + (C - y) * 1.0) * 1.4, 0, 1)
    plate = np.array(PLATE_DARK, float) + (np.array(PLATE_LIT, float) - np.array(PLATE_DARK, float)) * lit[..., None]
    grime = fractal(21, (6, 14, 40), (0.5, 0.35, 0.15))
    plate *= (0.90 + 0.14 * grime)[..., None]
    disc = disc_mask(R)
    a = np.asarray(disc, float)[..., None] / 255
    img = img * (1 - a) + plate * a

    # Rolled rim: a dark groove with a lit lip just inside it.
    img = paint(img, ring(R * 0.928, 0.0055), (128, 48, 19), 0.95)
    img = paint(img, ring(R * 0.915, 0.0022), (236, 138, 84), 0.55)
    # Outer edge catches light at the top left and falls dark at the bottom right.
    edge = (np.asarray(ring(R - 0.0025, 0.004), float) / 255)[..., None] * 0.8
    edge_col = np.where(((C - x) + (C - y))[..., None] > 0, np.array((240, 150, 96), float), np.array((86, 32, 12), float))
    img = img * (1 - edge) + edge_col * edge

    # Paint wear on the plate: chips to bare rust, denser toward the rim.
    chip_n = fractal(5, (20, 56, 150, 360), (0.32, 0.30, 0.22, 0.16))
    rim_bias = np.clip((r / R - 0.55) / 0.45, 0, 1) ** 1.5
    worn = chip_n + 0.16 * rim_bias
    chip = np.clip((worn - 0.80) / 0.035, 0, 1) * a[..., 0]
    pitted = np.clip((worn - 0.86) / 0.03, 0, 1) * a[..., 0]
    img = img * (1 - chip[..., None]) + np.array(RUST, float) * chip[..., None]
    img = img * (1 - pitted[..., None]) + np.array(RUST_DEEP, float) * pitted[..., None]

    # Trefoil in black enamel, worn through to the orange underneath in a few flecks.
    tre = (np.asarray(trefoil_mask(), float) / 255)[..., None]
    fleck_n = fractal(9, (30, 90, 240), (0.4, 0.35, 0.25))
    fleck = np.clip((fleck_n - 0.835) / 0.03, 0, 1)[..., None]
    ink = np.array(INK, float) * (1 - fleck) + np.array((150, 60, 24), float) * fleck
    img = img * (1 - tre) + ink * tre

    # Rivets in the band between rim groove and edge.
    rv = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(rv)
    rr, size = R * 0.962 * N, 0.0115 * N
    for i in range(12):
        ang = 2 * math.pi * i / 12 + math.pi / 12
        cx, cy = C * N + rr * math.cos(ang), C * N + rr * math.sin(ang)
        o = size * 0.35
        d.ellipse([cx - size + o, cy - size + o, cx + size + o, cy + size + o], fill=(60, 22, 9, 170))   # shadow
        d.ellipse([cx - size, cy - size, cx + size, cy + size], fill=(168, 66, 27, 255))                 # head
        hx, hy, h = cx - size * 0.45, cy - size * 0.45, size * 0.32
        d.ellipse([hx - h, hy - h, hx + h, hy + h], fill=(246, 178, 126, 255))                           # glint
    rva = np.asarray(rv.resize((S, S), Image.LANCZOS), float)
    al = rva[..., 3:4] / 255
    img = img * (1 - al) + rva[..., :3] * al

    # A few fine scratches through the paint.
    sc = Image.new("L", (N, N), 0)
    sd = ImageDraw.Draw(sc)
    rng = np.random.default_rng(14)
    for _ in range(9):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0.15, 0.8) * R * N
        px, py = C * N + dist * math.cos(ang), C * N + dist * math.sin(ang)
        th = rng.uniform(-0.6, 0.6) + math.pi / 4
        ln = rng.uniform(0.03, 0.09) * N
        sd.line([(px, py), (px + ln * math.cos(th), py + ln * math.sin(th))], fill=255, width=int(0.0016 * N))
    sc = ImageChops.multiply(sc.resize((S, S), Image.LANCZOS), disc)
    img = paint(img, sc, (238, 146, 96), 0.35)

    img += np.random.default_rng(3).normal(0, 2.0, img.shape)  # film grain
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def circle_preview(img, px, bg=(49, 51, 56)):
    im = img.resize((px, px), Image.LANCZOS)
    m = Image.new("L", (px * 4, px * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, px * 4 - 1, px * 4 - 1], fill=255)
    out = Image.new("RGB", (px, px), bg)
    out.paste(im, (0, 0), m.resize((px, px), Image.LANCZOS))
    return out


if __name__ == "__main__":
    icon = render()
    icon.save(OUT / "rust-legacy-icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(OUT / "rust-legacy-icon-512.png")
    # Discord dark sidebar at 128/80/48/32, then the light theme at 48/32.
    strip = Image.new("RGB", (580, 180), (49, 51, 56))
    x = 20
    for px in (128, 80, 48, 32):
        strip.paste(circle_preview(icon, px), (x, 90 - px // 2))
        x += px + 24
    light = (227, 229, 232)
    strip.paste(Image.new("RGB", (580 - x + 6, 180), light), (x - 6, 0))
    x += 14
    for px in (48, 32):
        strip.paste(circle_preview(icon, px, light), (x, 90 - px // 2))
        x += px + 24
    strip.save(OUT / "_discord-preview.png")
