"""Render the approved lobby still as an eight-second surf cinemagraph.

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
DURATION, FPS, RATE = 8, 24, 44100
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
    side = noise(120, 840) * 0.22
    stereo = np.stack((wash + foam + side, wash + foam - side), axis=1)
    stereo *= 0.17 / np.max(np.abs(stereo))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2",
         "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "80k",
         str(ROOMS / "stage-golden-hour-surf-v1.mp3")],
        input=stereo.astype("<f4").tobytes(), check=True,
    )


def main():
    data = POSTER.read_bytes()
    checksum = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if checksum != POSTER_SHA:
        raise ValueError("Ocean masks require the exact approved lobby frame")
    still = Image.open(POSTER).convert("RGB")
    encode_video(still, "stage-golden-hour-surf-v1.mp4",
                 ["-vf", "addroi=x=38:y=250:w=144:h=45:qoffset=-0.28",
                  "-c:v", "libx264", "-crf", "21", "-preset", "slow",
                  "-tune", "grain", "-movflags", "+faststart"])
    encode_video(still, "stage-golden-hour-surf-v1.webm",
                 ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "22", "-cpu-used", "2",
                  "-lag-in-frames", "0", "-auto-alt-ref", "0"])
    encode_sound()


if __name__ == "__main__":
    main()
