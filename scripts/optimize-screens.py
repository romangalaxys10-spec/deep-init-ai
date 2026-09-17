#!/usr/bin/env python3
"""Optimize README screenshots: LANCZOS downscale to max 1600px wide + PNG optimize."""
from PIL import Image
from pathlib import Path

D = Path("/home/z/my-project/docs/screenshots")
MAX_W = 1600
total_before = total_after = 0
for p in sorted(D.glob("*.png")):
    before = p.stat().st_size
    img = Image.open(p)
    if img.width > MAX_W:
        ratio = MAX_W / img.width
        img = img.resize((MAX_W, round(img.height * ratio)), Image.LANCZOS)
    img.save(p, optimize=True)
    after = p.stat().st_size
    total_before += before
    total_after += after
    print(f"{p.name:34s} {before//1024:5d}K -> {after//1024:5d}K  ({img.width}x{img.height})")
print(f"TOTAL {total_before//1024}K -> {total_after//1024}K")
