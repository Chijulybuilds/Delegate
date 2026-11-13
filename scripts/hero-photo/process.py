#!/usr/bin/env python3
"""
Builds the landing-page hero assets from the hand-holding-a-phone photo.

    python3 scripts/hero-photo/process.py [path/to/photo.jpg] [--debug DIR]

Requires Python 3.9+ with numpy and Pillow (`pip install numpy pillow`).
Defaults to scripts/hero-photo/source.jpg (466 x 580). The phone geometry below is measured
on that photo in source pixels; a larger export of the same shot works unchanged because
everything is scaled from the source size.

What it does
  1. Cuts the hand + phone out of the studio background (soft, de-fringed edges).
  2. Blanks the phone's screen (the browser renders a live Delegate app there instead).
  3. Separates the three fingertips that overlap the screen into their own layer, so the
     live screen sits *behind* them, with a soft contact shadow on the glass.
  4. Re-tones the hand to a deep brown skin tone, keeping the photo's own light and shadow
     (palms a little warmer and lighter than the backs of the fingers, as on a real hand).
     The hand is otherwise exactly as photographed.

Outputs (apps/web/src/landing/assets/, imported by PhotoPhone.tsx so Vite fingerprints them)
  hand-phone.webp     RGBA: transparent background, re-toned hand, blank screen
  phone-fingers.webp  RGBA: only the fingertips over the screen (+ their shadow on the glass)
  hand-phone.json     pixel geometry: canvas size and the screen rectangle
"""
from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "src" / "landing" / "assets"

SRC_W, SRC_H = 466, 580  # the photo the geometry below was measured on
SCALE = 2  # working resolution = source x SCALE
PAD_L, PAD_B = 0, 0  # no extra canvas: the photo is used as framed

# Phone, measured in source pixels (the phone is upright: no rotation, no perspective).
OUTER = (141.0, 69.0, 327.6, 461.6, 27.0)  # x0, y0, x1, y1, corner radius — outside of the copper frame
INNER = (143.6, 71.6, 324.4, 458.6, 24.5)  # inside of the frame: everything here is glass
DISPLAY = (146.6, 74.6, 321.4, 455.4, 22.0)  # the lit display area (a 3 px black bezel surrounds it)
FINGER_ROI = (299.5, 256.0, 324.4, 459.0)  # where fingertips overlap the glass

# Deep brown skin ramps (dark → light) applied along the original skin's lightness.
DORSAL_RAMP = [(0.00, "#1b0f09"), (0.22, "#2f1a10"), (0.45, "#4a2b1b"), (0.65, "#633a24"), (0.80, "#7b4a2f"), (0.92, "#94603f"), (1.00, "#b07c5c")]
PALM_RAMP = [(0.00, "#24140c"), (0.22, "#3b2215"), (0.45, "#5c3622"), (0.65, "#7a4b31"), (0.80, "#93603f"), (0.92, "#ac7a57"), (1.00, "#c49373")]
NAIL_RAMP = [(0.00, "#5a3a2e"), (0.45, "#9a7262"), (0.75, "#c49d8c"), (1.00, "#e8d3c8")]


# ----------------------------------------------------------------------------- colour maths
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    xyz = srgb_to_linear(rgb) @ _M.T / _WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f**3 > 216 / 24389, f**3, (116 * f - 16) / (24389 / 27)) * _WHITE
    return linear_to_srgb(xyz @ np.linalg.inv(_M).T)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])


def ramp(t, stops):
    """Map t in [0, 1] through colour stops, interpolating in Lab."""
    pos = np.array([p for p, _ in stops])
    lab = rgb_to_lab(np.array([hex_rgb(c) for _, c in stops]))
    return np.stack([np.interp(t, pos, lab[:, i]) for i in range(3)], -1)


# ----------------------------------------------------------------------------- mask helpers
def flood(allowed: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """4-connected flood fill of `allowed` starting from `seeds`."""
    H, W = allowed.shape
    al = bytearray(allowed.astype(np.uint8).ravel().tobytes())
    out = bytearray(H * W)
    q = deque()
    for i in np.flatnonzero(seeds.ravel() & allowed.ravel()).tolist():
        out[i] = 1
        q.append(i)
    while q:
        i = q.popleft()
        x = i % W
        for j in (i - 1 if x > 0 else -1, i + 1 if x < W - 1 else -1, i - W, i + W):
            if 0 <= j < H * W and al[j] and not out[j]:
                out[j] = 1
                q.append(j)
    return np.frombuffer(bytes(out), dtype=np.uint8).reshape(H, W).astype(bool)


def components(mask: np.ndarray) -> list[np.ndarray]:
    """4-connected components of a boolean mask, as arrays of flat indices."""
    H, W = mask.shape
    m = bytearray(mask.astype(np.uint8).ravel().tobytes())
    out = []
    for start in np.flatnonzero(mask.ravel()).tolist():
        if not m[start]:
            continue
        m[start] = 0
        q, comp = deque([start]), [start]
        while q:
            i = q.popleft()
            x = i % W
            for j in (i - 1 if x > 0 else -1, i + 1 if x < W - 1 else -1, i - W, i + W):
                if 0 <= j < H * W and m[j]:
                    m[j] = 0
                    q.append(j)
                    comp.append(j)
        out.append(np.array(comp))
    return out


def to_img(mask: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), "L")


def from_img(img: Image.Image) -> np.ndarray:
    return np.asarray(img).astype(np.float32) / 255


def dilate(mask, size):
    return from_img(to_img(mask.astype(np.float32)).filter(ImageFilter.MaxFilter(size))) > 0.5


def erode(mask, size):
    return from_img(to_img(mask.astype(np.float32)).filter(ImageFilter.MinFilter(size))) > 0.5


def blur(arr, radius):
    return from_img(to_img(arr).filter(ImageFilter.GaussianBlur(radius)))


def rounded_rect(shape, box, k, ss=4):
    """Anti-aliased rounded rectangle; box in working pixels (x0, y0, x1, y1, r)."""
    H, W = shape
    x0, y0, x1, y1, r = box
    img = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(img).rounded_rectangle([x0 * ss, y0 * ss, x1 * ss - 1, y1 * ss - 1], radius=r * ss, fill=255)
    return from_img(img.resize((W, H), Image.LANCZOS))


class Canvas:
    """Source-pixel → working-pixel transform for the padded canvas."""

    def __init__(self, scale, pad_l, pad_b):
        self.s, self.pl = scale, pad_l
        self.W, self.H = (SRC_W + pad_l) * scale, (SRC_H + pad_b) * scale

    def x(self, v):
        return (v + self.pl) * self.s

    def y(self, v):
        return v * self.s

    def box(self, b):
        x0, y0, x1, y1, *r = b
        return (self.x(x0), self.y(y0), self.x(x1), self.y(y1), *(v * self.s for v in r))


# ----------------------------------------------------------------------------- pipeline
def main(src_path: Path, debug: Path | None) -> None:
    src = Image.open(src_path).convert("RGB")
    k = src.width / SRC_W  # a larger export of the same photo
    s = SCALE / k
    work = src.resize((round(src.width * s), round(src.height * s)), Image.LANCZOS)
    work = work.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=2))
    photo = np.asarray(work).astype(np.float32) / 255
    h0, w0, _ = photo.shape
    cv = Canvas(SCALE, PAD_L, PAD_B)
    H, W = cv.H, cv.W
    ox = cv.x(0)  # where the photo starts horizontally on the canvas
    yy, xx = np.mgrid[0:H, 0:W]
    sx, sy = xx / SCALE - PAD_L, yy / SCALE  # source coordinates of every canvas pixel
    print(f"source {src.size} → canvas {W}x{H}")

    def dbg(name, arr):
        if debug:
            debug.mkdir(parents=True, exist_ok=True)
            a = np.clip(arr, 0, 1)
            mode = "L" if a.ndim == 2 else ("RGBA" if a.shape[-1] == 4 else "RGB")
            Image.fromarray((a * 255 + 0.5).astype(np.uint8), mode).save(debug / f"{name}.png")

    # 1. Background ------------------------------------------------------------------------
    border = np.concatenate([photo[0], photo[:, -1]])  # top + right edges are pure studio grey
    bg = np.median(border, axis=0)
    dist = np.abs(photo - bg).max(-1) * 255
    edge = np.zeros((h0, w0), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    bgmask = flood(dist < 12, edge)
    # Background pockets enclosed by the hand (between the thumb and the phone), never the screen.
    phone_box = rounded_rect((h0, w0), tuple(v * SCALE for v in OUTER), 4) > 0.01
    for comp in components((dist < 10) & ~bgmask & ~phone_box):
        if len(comp) >= 120 * SCALE * SCALE:
            bgmask.ravel()[comp] = True
    fg = ~bgmask
    band = fg & dilate(bgmask, 5)
    alpha_p = fg.astype(np.float32)
    alpha_p[band] = np.clip((dist[band] - 4) / 26, 0, 1)
    alpha_p = blur(alpha_p, 0.6)
    alpha_p[erode(fg, 7)] = 1.0
    a3 = alpha_p[..., None]
    photo = np.where((a3 > 0.02) & (a3 < 0.99), np.clip((photo - (1 - a3) * bg) / np.maximum(a3, 0.02), 0, 1), photo)

    # Place the photo on the padded canvas.
    rgb = np.zeros((H, W, 3), np.float32)
    alpha = np.zeros((H, W), np.float32)
    rgb[:h0, ox : ox + w0] = photo
    alpha[:h0, ox : ox + w0] = alpha_p
    inphoto = np.zeros((H, W), bool)
    inphoto[:h0, ox : ox + w0] = True

    # 2. Phone geometry --------------------------------------------------------------------
    outer = rounded_rect((H, W), cv.box(OUTER), SCALE)
    inner = rounded_rect((H, W), cv.box(INNER), SCALE)
    display = rounded_rect((H, W), cv.box(DISPLAY), SCALE)
    lum = photo_lum = rgb.mean(-1)

    # 3. Fingertips over the glass ----------------------------------------------------------
    fx0, fy0, fx1, fy1 = FINGER_ROI
    roi = (sx >= fx0) & (sx <= fx1) & (sy >= fy0) & (sy <= fy1) & inphoto
    roi &= ~((sx < 316) & (sy > 448))  # the wallpaper's corner glow, which touches the last fingertip
    cand = roi & (photo_lum > 75 / 255)
    cand = dilate(erode(cand, 5), 5) & roi  # opening: drops the wallpaper's thin glow lines
    right = roi & (sx >= fx1 - 1.5)
    fingers = flood(cand, right)
    fingers = dilate(fingers, 3) & roi & (photo_lum > 40 / 255) | fingers
    # Soft edge from the photo's own anti-aliasing against the dark glass.
    near = dilate(fingers, 5) & roi
    f_alpha = np.where(near, np.clip((photo_lum * 255 - 38) / 70, 0, 1), 0) * dilate(fingers, 3)
    f_alpha = np.maximum(f_alpha, erode(fingers, 3).astype(np.float32))
    f_alpha = blur(f_alpha, 0.5)
    # Where a fingertip crosses the copper frame (right of the glass), the frame strip is finger too.
    rows = np.flatnonzero(fingers[:, int(cv.x(fx1)) - 2])
    over_frame = np.zeros((H, W), np.float32)
    strip = (sx > fx1 - 0.5) & (sx <= OUTER[2] + 1.0)
    rowmask = np.zeros(H, bool)
    rowmask[rows] = True
    over_frame[rowmask[:, None] & strip] = 1.0
    over_frame = blur(over_frame, 0.8)
    # One continuous finger coverage from the glass, across the bezel and over the copper frame.
    f_alpha = np.maximum(f_alpha, over_frame * (dilate(fingers, 9) | (sx > fx1 - 1.5)))
    fingers_hard = f_alpha > 0.5
    dbg("01_fingers", np.dstack([f_alpha, lum * 0.6, lum * 0.6]))

    # 4. Skin -------------------------------------------------------------------------------
    phone_body = (outer > 0.5) & ~fingers_hard & ~(over_frame > 0.5)
    skin = (alpha > 0.5) & ~phone_body & inphoto
    not_phone = 1 - np.clip(outer - np.maximum(f_alpha, over_frame), 0, 1)
    skin_soft = np.clip(blur(skin.astype(np.float32), 0.9) * not_phone + f_alpha, 0, 1)

    lab = rgb_to_lab(rgb)
    L = lab[..., 0]
    sk = skin & (alpha > 0.9)
    lo, hi = np.percentile(L[sk], 1.5), np.percentile(L[sk], 99.3)
    tt = np.clip((L - lo) / (hi - lo), 0, 1)

    # Which way each part of the hand faces: palm (lower palm, thumb base) vs backs of the fingertips.
    palm_w = np.zeros((H, W), np.float32)
    pimg = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(pimg)
    P = lambda pts: [(cv.x(x), cv.y(y)) for x, y in pts]  # noqa: E731
    d.polygon(P([(-200, 300), (142, 300), (142, 470), (300, 466), (372, 445), (372, 520), (300, 640), (-200, 900)]), fill=255)  # palm + thenar
    d.polygon(P([(90, 150), (142, 150), (142, 300), (80, 300)]), fill=150)  # side of the thumb
    d.polygon(P([(328, 182), (380, 182), (380, 250), (328, 250)]), fill=70)  # index finger, seen from the side
    palm_w = blur(from_img(pimg), 9 * SCALE)

    # Nails: the lightest, least saturated parts of the fingertips and thumb tip.
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    nail_zone = ((sx >= 296) & (sy >= 256) & (sy <= 462)) | ((sx >= 92) & (sx <= 142) & (sy >= 150) & (sy <= 205))
    nails = sk & nail_zone & (L > np.percentile(L[sk], 80)) & (chroma < np.percentile(chroma[sk], 30))
    nails = dilate(erode(nails, 3), 3)
    nail_soft = blur(nails.astype(np.float32), 1.6) * (skin_soft > 0)
    dbg("02_nails", np.dstack([nail_soft, lum * 0.5, palm_w * 0.6]))

    target = ramp(tt, DORSAL_RAMP) * (1 - palm_w[..., None]) + ramp(tt, PALM_RAMP) * palm_w[..., None]
    # Keep a little of the original warmth variation (knuckles, fingertips) for realism.
    a_med, b_med = np.median(lab[..., 1][sk]), np.median(lab[..., 2][sk])
    target[..., 1] += 0.35 * (lab[..., 1] - a_med)
    target[..., 2] += 0.25 * (lab[..., 2] - b_med)
    nail_t = np.clip((L - np.percentile(L[nails], 5)) / max(1e-3, np.percentile(L[nails], 99) - np.percentile(L[nails], 5)), 0, 1) if nails.any() else tt
    nail_lab = ramp(nail_t * 0.7 + 0.3 * tt, NAIL_RAMP)
    target = target * (1 - nail_soft[..., None]) + nail_lab * nail_soft[..., None]
    toned = lab_to_rgb(target)
    rgb = rgb * (1 - skin_soft[..., None]) + toned * skin_soft[..., None]

    # 5. Blank glass: everything inside the frame becomes the black bezel / dark display ------
    glass = np.array([0.018, 0.018, 0.022])
    g = np.clip(inner - f_alpha, 0, 1)[..., None]
    rgb = rgb * (1 - g) + glass * g
    alpha = np.maximum(alpha, inner)
    dbg("03_toned", np.dstack([rgb, alpha]))

    # 6. Fingertips layer: the toned fingers + a soft contact shadow on the glass -------------
    shadow = blur(np.roll(np.roll(f_alpha, 2 * SCALE, 0), -3 * SCALE, 1), 3.5 * SCALE) * 0.55
    shadow = shadow * (1 - f_alpha) * (display > 0.5)
    fa = np.clip(f_alpha + shadow, 0, 1)
    f_rgb = np.where(f_alpha[..., None] > 0, rgb * (f_alpha / np.maximum(fa, 1e-4))[..., None], 0)
    fingers_rgba = np.dstack([f_rgb, fa])

    # 7. Geometry ------------------------------------------------------------------------------
    x0, y0, x1, y1, r = cv.box(DISPLAY)
    ox0, oy0, ox1, oy1, orr = cv.box(OUTER)
    meta = {
        "width": W,
        "height": H,
        "screen": {"x": round(x0, 1), "y": round(y0, 1), "w": round(x1 - x0, 1), "h": round(y1 - y0, 1), "r": round(r, 1)},
        "phone": {"x": round(ox0, 1), "y": round(oy0, 1), "w": round(ox1 - ox0, 1), "h": round(oy1 - oy0, 1), "r": round(orr, 1)},
    }

    # 8. Write -------------------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    save_rgba(np.dstack([rgb, alpha]), OUT / "hand-phone.webp", 90)
    save_rgba(fingers_rgba, OUT / "phone-fingers.webp", 92, crop_to=(int(cv.x(FINGER_ROI[0]) - 40), 0, W, H))
    (OUT / "hand-phone.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta))
    if debug:
        dbg("05_fingers_layer", fingers_rgba)


def save_rgba(rgba, path, quality, crop_to=None):
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    if crop_to:  # keep the full canvas size (so layers align) but blank everything outside the crop
        blank = Image.new("RGBA", img.size, (0, 0, 0, 0))
        blank.paste(img.crop(crop_to), crop_to[:2])
        img = blank
    img.save(path, "WEBP", quality=quality, method=6, exact=False)


if __name__ == "__main__":
    args = sys.argv[1:]
    dbg_dir = None
    if "--debug" in args:
        i = args.index("--debug")
        dbg_dir = Path(args[i + 1])
        del args[i : i + 2]
    main(Path(args[0]) if args else Path(__file__).with_name("source.jpg"), dbg_dir)
