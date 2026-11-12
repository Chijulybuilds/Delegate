#!/usr/bin/env python3
"""
Builds the landing-page hero assets from the hand-holding-a-cup photo.

    python3 scripts/hero-photo/process.py [path/to/photo.jpg]

Requires Python 3.9+ with numpy and Pillow (`pip install numpy pillow`).
Defaults to scripts/hero-photo/source.jpg. Drop in a higher-resolution export of the same
photo and re-run to get sharper assets; everything is derived from relative positions.

What it does
  1. Cuts the hand + cup out of the studio background (soft, de-fringed edges).
  2. Re-tones the hand to a deep brown skin tone, keeping the photo's own light and shadow.
  3. Removes the mockup's printed branding from the cup (column-wise inpaint).
  4. Exports a cup mask + a shading map, so the browser can recolour the cup live
     (Open → In progress → Executed → Audited) and print the Delegate design on it.

Outputs (apps/web/src/landing/assets/, imported by PhotoCup.tsx so Vite fingerprints them)
  hand-cup.webp   RGBA photo: transparent background, re-toned hand, blank cup
  cup-mask.png    alpha mask of the visible cup body (fingers stay in front)
  cup-shade.webp  grayscale lighting of the cup, 50% grey = neutral (for `overlay` blending)
  hand-cup.json   pixel geometry of the cup, used to place the printed design
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

# Cup search region as fractions of the photo (generous; colour decides the exact edge).
CUP_TRAPEZOID = {"top": 0.195, "bottom": 0.655, "top_l": 0.33, "top_r": 0.80, "bot_l": 0.365, "bot_r": 0.75}
LID_BOTTOM = 0.235

# Deep brown skin ramp (dark → light) applied along the original skin's lightness.
SKIN_RAMP = [
    (0.00, "#1b0f09"),
    (0.22, "#2f1a10"),
    (0.45, "#4a2b1b"),
    (0.65, "#633a24"),
    (0.80, "#7b4a2f"),
    (0.92, "#94603f"),
    (1.00, "#b07c5c"),
]


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


def rgb_to_hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    safe = np.where(d == 0, 1, d)
    h = np.where(mx == r, ((g - b) / safe) % 6, h)
    h = np.where(mx == g, (b - r) / safe + 2, h)
    h = np.where(mx == b, (r - g) / safe + 4, h)
    h = np.where(d == 0, 0, h) * 60
    s = np.where(mx == 0, 0, d / np.where(mx == 0, 1, mx))
    return h, s, mx


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])


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


def envelope_fit(t, x, side, degree=1, iters=8, tol=3.0):
    """Fit x(t) to the outer envelope of noisy edge samples; samples pulled inward by
    occlusion (side=-1 → larger x, side=+1 → smaller x) are rejected iteratively."""
    keep = np.ones_like(t, dtype=bool)
    coef = np.polyfit(t, x, degree)
    for _ in range(iters):
        coef = np.polyfit(t[keep], x[keep], degree)
        res = (x - np.polyval(coef, t)) * side
        new = res > -tol
        if new.sum() < max(10, degree * 5) or (new == keep).all():
            break
        keep = new
    return coef if degree > 1 else (coef[1], coef[0])


def smooth1d(v, sigma):
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    return np.convolve(np.pad(v, r, mode="edge"), k, mode="valid")


# ----------------------------------------------------------------------------- pipeline
def main(src_path: Path) -> None:
    src = Image.open(src_path).convert("RGB")
    scale = max(1, round(1300 / src.height))
    img = src.resize((src.width * scale, src.height * scale), Image.LANCZOS)
    if scale > 1:
        img = img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))
    rgb = np.asarray(img).astype(np.float32) / 255
    H, W, _ = rgb.shape
    yy, xx = np.mgrid[0:H, 0:W]
    print(f"source {src.size} → working {W}x{H}")

    # 1. Background ------------------------------------------------------------------
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.abs(rgb - bg).max(-1) * 255
    edge = np.zeros((H, W), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    bgmask = flood(dist < 12, edge)
    # Background pockets enclosed by the hand (e.g. the gap between thumb and cup).
    for comp in components((dist < 9) & ~bgmask):
        if len(comp) >= 600:
            bgmask.ravel()[comp] = True
    fg = ~bgmask
    band = fg & dilate(bgmask, 5)
    alpha = fg.astype(np.float32)
    alpha[band] = np.clip((dist[band] - 4) / 26, 0, 1)
    alpha = blur(alpha, 0.6)
    alpha[erode(fg, 7)] = 1.0
    # De-fringe: remove the grey background bleeding into semi-transparent edge pixels.
    a3 = alpha[..., None]
    rgb = np.where((a3 > 0.02) & (a3 < 0.99), np.clip((rgb - (1 - a3) * bg) / np.maximum(a3, 0.02), 0, 1), rgb)

    # 2. Cup body ---------------------------------------------------------------------
    h, s, v = rgb_to_hsv(rgb)
    t = CUP_TRAPEZOID
    trap_img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(trap_img).polygon(
        [(t["top_l"] * W, t["top"] * H), (t["top_r"] * W, t["top"] * H), (t["bot_r"] * W, t["bottom"] * H), (t["bot_l"] * W, t["bottom"] * H)], fill=255
    )
    trap = np.asarray(trap_img) > 0
    kraft = trap & fg & (h >= 28.5) & (h <= 46) & (s >= 0.08) & (v >= 0.12) & (v <= 0.96)
    kraft = dilate(erode(kraft, 3), 3)  # drop specks

    # Fit the cup's true outline: straight tapered sides, elliptical top (lid) and bottom.
    krows = np.flatnonzero(kraft.sum(1) > 20)
    ys = np.arange(krows[0] + 6, krows[-1] - 6)
    lefts = np.array([np.flatnonzero(kraft[y])[0] for y in ys], dtype=float)
    rights = np.array([np.flatnonzero(kraft[y])[-1] for y in ys], dtype=float)
    la, lb = envelope_fit(ys, lefts, -1)
    ra, rb = envelope_fit(ys, rights, +1)
    kcols = np.flatnonzero(kraft.sum(0) > 20)
    xs_all = np.arange(kcols[0], kcols[-1] + 1)
    tops = np.array([np.flatnonzero(kraft[:, x])[0] for x in xs_all], dtype=float)
    bots = np.array([np.flatnonzero(kraft[:, x])[-1] for x in xs_all], dtype=float)
    top_curve = envelope_fit(xs_all, tops, -1, degree=2)  # lid hides the top: keep the highest rows
    bot_curve = envelope_fit(xs_all, bots, +1, degree=2)  # fingers hide the bottom right: keep the lowest
    xline_l, xline_r = la + lb * yy, ra + rb * yy
    geo = (xx >= xline_l) & (xx <= xline_r) & (yy >= np.polyval(top_curve, xx)) & (yy <= np.polyval(bot_curve, xx)) & fg

    # Fingers are skin-coloured pixels that reach into the cup outline from outside.
    skin_like = fg & ~kraft & ((h < 28.5) | (h > 300))
    geo_border = geo & ~erode(geo, 3)
    fingers = flood(geo & skin_like, geo_border)
    fingers = dilate(fingers, 3) & geo & ~kraft | fingers
    occluders = fingers
    cup = geo & ~fingers
    # Keep only the cup's main body: drops kraft-coloured specks on the fingers.
    core = dilate(erode(cup, 7), 7)
    centre = np.zeros_like(cup)
    cy0, cx0 = int((krows[0] + krows[-1]) / 2), int((la + lb * (krows[0] + krows[-1]) / 2 + ra + rb * (krows[0] + krows[-1]) / 2) / 2)
    centre[cy0 - 2 : cy0 + 3, cx0 - 2 : cx0 + 3] = True
    cup = cup & dilate(flood(core, centre), 5)
    cup = erode(dilate(cup, 3), 3)
    cup_soft = blur(cup.astype(np.float32), 0.8) * alpha

    # 3. Lid + skin -------------------------------------------------------------------
    lid = fg & (yy < LID_BOTTOM * H) & ~cup
    skin = fg & ~cup & ~lid
    skin_soft = blur(skin.astype(np.float32), 1.0)

    # 4. Rebuild the cup as a clean lit cylinder (erases the mockup's printed branding) ----
    #    lightness(x, y) = column profile (cylinder curvature) + row profile (lid shadow, falloff)
    lab_src = rgb_to_lab(rgb)
    cupL_src = lab_src[..., 0]
    printed = dilate(cup & ~kraft, 13) & cup  # text + its JPEG halo
    sample = cup & ~printed & erode(cup, 5)
    col = np.full(W, np.nan)
    for x in range(W):
        ys = np.flatnonzero(sample[:, x])
        if len(ys) > 8:
            col[x] = np.median(cupL_src[ys, x])
    ok = np.flatnonzero(~np.isnan(col))
    col = smooth1d(np.interp(np.arange(W), ok, col[ok]), 5)
    resid = cupL_src - col[None, :]
    row = np.full(H, np.nan)
    for y in range(H):
        xs_ = np.flatnonzero(sample[y])
        if len(xs_) > 8:
            row[y] = np.median(resid[y, xs_])
    ok = np.flatnonzero(~np.isnan(row))
    row = smooth1d(np.interp(np.arange(H), ok, row[ok]), 24)
    modelL = col[None, :] + row[:, None]
    # Soft contact shadow where fingers and the lid meet the cup.
    occ = (occluders | lid) & fg & dilate(cup, 41)
    modelL -= 16 * blur(occ.astype(np.float32), 9)
    kraft_a, kraft_b = np.median(lab_src[..., 1][sample]), np.median(lab_src[..., 2][sample])
    model_rgb = lab_to_rgb(np.stack([modelL, np.full_like(modelL, kraft_a), np.full_like(modelL, kraft_b)], -1))
    clean = np.where(dilate(cup, 3)[..., None], model_rgb, rgb)

    # 5. Re-tone the hand -----------------------------------------------------------------
    lab = rgb_to_lab(clean)
    L = lab[..., 0]
    sk = skin & (alpha > 0.5)
    lo, hi = np.percentile(L[sk], 1.5), np.percentile(L[sk], 99.5)
    tt = np.clip((L - lo) / (hi - lo), 0, 1)
    ramp_t = np.array([p for p, _ in SKIN_RAMP])
    ramp_lab = rgb_to_lab(np.array([hex_rgb(c) for _, c in SKIN_RAMP]))
    target = np.stack([np.interp(tt, ramp_t, ramp_lab[:, i]) for i in range(3)], -1)
    # Keep a little of the original warmth variation (knuckles, fingertips) for realism.
    a_med, b_med = np.median(lab[..., 1][sk]), np.median(lab[..., 2][sk])
    target[..., 1] += 0.35 * (lab[..., 1] - a_med)
    target[..., 2] += 0.25 * (lab[..., 2] - b_med)
    toned = lab_to_rgb(target)
    out_rgb = clean * (1 - skin_soft[..., None]) + toned * skin_soft[..., None]

    # 6. Cup lighting map (neutral 0.5) for CSS `overlay` blending ---------------------
    cl = modelL[cup]
    med, spread = np.median(cl), max(np.percentile(cl, 98) - np.percentile(cl, 2), 1)
    shade = np.clip(0.5 + (modelL - med) / spread * 0.55, 0.12, 0.88)
    shade = np.where(dilate(cup, 5), shade, 0.5).astype(np.float32)

    # 7. Geometry for the printed design ----------------------------------------------------
    rows = np.flatnonzero(cup.any(1))
    top, bottom = int(rows[0]), int(rows[-1])
    def left_edge(y):
        xs = np.flatnonzero(cup[y])
        return int(xs[0]) if len(xs) else None
    yt, yb = top + int(0.04 * (bottom - top)), bottom - int(0.04 * (bottom - top))
    top_xs = np.flatnonzero(cup[yt])
    axis = (top_xs[0] + top_xs[-1]) / 2
    lt, lb = left_edge(yt), left_edge(yb)
    lid_rows = np.flatnonzero(lid.any(1))
    lid_cols = np.flatnonzero(lid[lid_rows[len(lid_rows) // 3]]) if len(lid_rows) else np.array([axis])
    meta = {
        "width": W,
        "height": H,
        "cup": {
            "top": top,
            "bottom": bottom,
            "axisX": round(float(axis), 1),
            "topLeft": lt,
            "topRight": round(float(2 * axis - lt), 1),
            "bottomLeft": lb,
            "bottomRight": round(float(2 * axis - lb), 1),
        },
        "lid": {"top": int(lid_rows[0]) if len(lid_rows) else top, "centerX": round(float((lid_cols[0] + lid_cols[-1]) / 2), 1)},
    }

    # 8. Write ------------------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    rgba = np.dstack([out_rgb, alpha])
    Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "hand-cup.webp", "WEBP", quality=90, method=6)
    mask_rgba = np.dstack([np.ones((H, W, 3)), cup_soft])
    Image.fromarray((mask_rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "cup-mask.png", optimize=True)
    Image.fromarray((shade * 255 + 0.5).astype(np.uint8), "L").convert("RGB").save(OUT / "cup-shade.webp", "WEBP", quality=88, method=6)
    (OUT / "hand-cup.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("wrote", ", ".join(p.name for p in sorted(OUT.iterdir())))
    print(json.dumps(meta))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("source.jpg"))
