#!/usr/bin/env python3
"""Offline, zero-provider canonical venue still-to-video rendering.

Input is an already downloaded, explicitly approved canonical image file.
No network calls, no image generation, no panning, no alterations to the master.
Output is a separate unapproved QA artifact; never publish automatically.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOMS = {"stage", "kitchen", "gallery", "cigar_lounge", "community"}
def render(room: str, source: Path, sha256: str, output: Path, ffmpeg: str = "ffmpeg"):
    if room not in ROOMS:
        raise ValueError("Room is not in approved recovery scope")
    if not source.is_file() or source.is_symlink():
        raise ValueError("An existing local regular canonical source is required")
    raw = source.read_bytes()
    if not raw or len(raw) > 10_000_000:
        raise ValueError("Canonical source size unsupported")
    actual = hashlib.sha256(raw).hexdigest()
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256) or actual != sha256:
        raise ValueError("Source bytes differ from explicitly approved SHA-256")
    if output.exists() or output.is_symlink():
        raise ValueError("Refusing to overwrite existing file")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Fitting and padding (never cropping) preserves the complete approved still.
    filtergraph = ("scale=1280:720:force_original_aspect_ratio=decrease,"
                   "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x101010,"
                   "setsar=1,format=yuv420p")
    with tempfile.TemporaryDirectory(prefix="cs-deterministic-") as temp:
        tmp = Path(temp) / "preview.mp4"
        command = [
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-loop", "1", "-framerate", "24", "-i", str(source),
            "-vf", filtergraph, "-t", "5", "-an",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-movflags", "+faststart", str(tmp),
        ]
        subprocess.run(command, check=True, timeout=120)
        rendered = tmp.read_bytes()
        if not rendered:
            raise RuntimeError("Empty render")
        output.write_bytes(rendered)
    return {"room": room, "source_sha256": actual,
            "output_sha256": hashlib.sha256(rendered).hexdigest(),
            "duration_seconds": 5, "format": "1280x720@24fps",
            "status": "qa_pending", "method": "deterministic_still",
            "publish_authorized": False}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--room", choices=sorted(ROOMS), required=True)
    p.add_argument("--approved-local-image", type=Path, required=True)
    p.add_argument("--approved-sha256", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--ffmpeg", default="ffmpeg")
    a = p.parse_args()
    receipt = render(a.room, a.approved_local_image, a.approved_sha256, a.output, a.ffmpeg)
    print(json.dumps(receipt, sort_keys=True))

if __name__ == "__main__":
    main()
