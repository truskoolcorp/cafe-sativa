"""Render the approved lobby still as an eight-second surf and candle loop.

Run from the repository root with Python, Pillow, NumPy and FFmpeg.
No network, generative provider, or stock audio is used.
"""

import hashlib
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOMS = Path("public/rooms")
POSTER = ROOMS / "stage-beach-terrace-v2.webp"
POSTER_SHA = "4d7e14453c93815d2c79dca3b0f708b22413c20b"  # Git blob hash
DURATION, FPS, RATE = 8, 24, 24000
SIZE = 1008, 564


def surf_frames(still):
    # Coordinates are locked to the approved 1344x752 frame. Exclude the
    # horizon, terrace posts, foliage and the dry beach (including feathering).
    x0, y0, x1, y1 = 50, 343, 237, 385
    band = np.array(still, dtype=np.uint8)[y0:y1, x0:x1].astype(np.float32)
    mask = Image.new("L", (x1 - x0, y1 - y0))
    windows = [
        [(65, 349), (137, 347), (199, 349), (199, 366), (176, 370),
         (153, 373), (102, 378), (66, 378), (69, 369), (62, 361)],
        [(215, 350), (225, 351), (226, 358), (221, 364), (214, 364)],
    ]
    for polygon in windows:
        ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in polygon], fill=255)
    blend = np.asarray(mask.filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32) / 255
    y, x = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    iy = (y - y0).astype(int)
    ix = (x - x0).astype(int)
    # The beach recedes toward the right. Advance every crest shoreward
    # across the diagonal shoreline, with wider spacing in the foreground.
    depth = (y - (372 - 0.045 * x)) / 8
    crest_phase = 2 * np.pi * (depth + 0.12 * depth ** 2)
    base = np.array(still)
    tint = np.array([1.0, 0.95, 0.79], dtype=np.float32)
    # Flame centers on the existing candles, not on the electric lighting.
    candles = [(27, 716, 1.0), (192, 416, 0.48), (321, 393, 0.36),
               (557, 505, 0.88), (593, 427, 0.46), (869, 427, 0.42),
               (946, 446, 0.52), (1110, 505, 0.80)]
    spots = []
    for cx, cy, size in candles:
        bx0, bx1 = max(0, cx - 22), min(still.width, cx + 23)
        by0, by1 = max(0, cy - 20), min(still.height, cy + 23)
        gy, gx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
        dx, dy = (gx - cx) / size, (gy - cy) / size
        falloff = np.exp(-0.5 * ((dx / 8) ** 2 + (dy / 9) ** 2))
        reflection = np.exp(-0.5 * ((dx / 10.5) ** 2 + ((dy - 12) / 3.2) ** 2))
        spots.append((slice(by0, by1), slice(bx0, bx1), dx, dy, falloff, reflection))
    amber = np.array([1.0, 0.69, 0.36], dtype=np.float32)

    for n in range(FPS * DURATION):
        t = 2 * np.pi * n / (FPS * DURATION)
        patch = base.copy()
        # Displace the existing surf texture, then add thin advancing foam
        # fronts; neither effect extends outside the masked water.
        offset = 1.9 * np.sin(crest_phase - 2 * t + 0.31 * np.sin(x / 29))
        offset += 0.8 * np.sin(crest_phase * 0.7 - 3 * t + x / 34)
        v = np.clip(iy - offset, 0, y1 - y0 - 1.01)
        j = np.floor(v).astype(int)
        fract = (v - j)[..., None]
        water = band[j, ix] * (1 - fract) + band[j + 1, ix] * fract
        crest = np.cos(crest_phase - 2 * t + 0.35 * np.sin(x / 16))
        taper = np.clip((y - 349) / 12, 0, 1)
        broken = 0.67 + 0.22 * np.sin(0.25 * x + 0.7 * np.sin(2 * t))
        foam = (np.maximum(crest, 0) ** 7 * 36 * broken - 4) * taper
        water += foam[..., None] * tint
        update = band + blend[..., None] * (water - band)
        patch[y0:y1, x0:x1] = np.uint8(np.clip(np.rint(update), 0, 255))
        for i, (sy, sx, dx, dy, glow, reflection) in enumerate(spots):
            p = 1.83 * i
            flutter = (0.48 * np.sin((7 + i % 3) * t + p)
                       + 0.31 * np.sin((13 + i % 5) * t - 1.4 * p)
                       + 0.14 * np.sin((23 + i % 4) * t + 0.9 * p))
            sway = 0.65 * np.sin((9 + i % 3) * t + 1.3 * p)
            core = np.exp(-0.5 * (((dx - sway) / 2.3) ** 2 + ((dy + flutter) / 4) ** 2))
            still_core = np.exp(-0.5 * ((dx / 2.3) ** 2 + (dy / 4) ** 2))
            change = flutter * (30 * core + 13 * glow + 6 * reflection) + 12 * (core - still_core)
            patch[sy, sx] = np.uint8(np.clip(np.rint(base[sy, sx] + change[..., None] * amber), 0, 255))
        yield Image.fromarray(patch).resize(SIZE, Image.Resampling.LANCZOS).tobytes()


def encode_video(still, filename, settings):
    with subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{SIZE[0]}x{SIZE[1]}", "-r", str(FPS), "-i", "pipe:0", "-an",
         "-pix_fmt", "yuv420p", *settings, str(ROOMS / filename)],
        stdin=subprocess.PIPE,
    ) as encoder:
        for frame in surf_frames(still):
            encoder.stdin.write(frame)
        encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError(f"Could not encode {filename}")


def encode_sound():
    # Circular filtering and integer numbers of swell cycles keep both the
    # sound bed and its amplitude envelope continuous across the seam.
    n = DURATION * RATE
    rng = np.random.default_rng(771)
    frequencies = np.fft.rfftfreq(n, d=1 / RATE)

    def noise(lo, hi):
        bins = np.fft.rfft(rng.standard_normal(n))
        shape = (frequencies ** 2 / (lo ** 2 + frequencies ** 2))
        shape /= (1 + (frequencies / hi) ** 2) ** 1.5
        filtered = np.fft.irfft(bins * shape, n=n)
        return filtered / np.std(filtered)

    t = np.arange(n, dtype=np.float64) * (2 * np.pi / n)
    swell = (0.50 + 0.50 * np.cos(2 * t - 0.55 + 0.27 * np.sin(t))) ** 1.7
    hush = (0.50 + 0.50 * np.cos(2 * t - 1.25 + 0.33 * np.sin(t))) ** 2.8
    wash = noise(45, 380) * (0.44 + 0.66 * swell)
    foam = noise(240, 1650) * (0.10 + 0.44 * hush)
    surf = wash + foam
    surf *= 0.17 / np.max(np.abs(surf))
    # Rotate the periodic waveform to a quiet zero crossing. PCM stores the
    # exact sample count without encoder delay, padding, or a loop gap.
    head = RATE // 6
    seam = np.abs(surf - np.roll(surf, 1)) + 0.20 * np.abs(surf)
    surf = np.roll(surf, -int(np.argmin(seam[:head])))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1",
         "-i", "pipe:0", "-c:a", "pcm_s16le", str(ROOMS / "stage-golden-hour-surf-v2.wav")],
        input=surf.astype("<f4").tobytes(), check=True,
    )


def main():
    data = POSTER.read_bytes()
    checksum = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if checksum != POSTER_SHA:
        raise ValueError("Ocean masks require the exact approved lobby frame")
    still = Image.open(POSTER).convert("RGB")
    encode_video(still, "stage-golden-hour-surf-v2.mp4",
                 ["-vf", "addroi=x=38:y=250:w=144:h=45:qoffset=-0.28",
                  "-c:v", "libx264", "-crf", "21", "-preset", "slow",
                  "-tune", "grain", "-movflags", "+faststart"])
    encode_video(still, "stage-golden-hour-surf-v2.webm",
                 ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "22", "-cpu-used", "2",
                  "-lag-in-frames", "0", "-auto-alt-ref", "0"])
    encode_sound()


if __name__ == "__main__":
    main()
