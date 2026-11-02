"""Regenerates the fixture images. They are drawn from code, so they carry no
third-party license and are identical on every run:

  python3 hma/clip/fixtures/generate.py

bank/scene.jpg   image added to the CLIP bank
probe/scene-resized.jpg   the same scene, resized and re-encoded (should match)
probe/other.jpg   an unrelated image (should not match)
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent


def scene():
    img = Image.new("RGB", (512, 512), (135, 190, 235))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 340, 512, 512], fill=(70, 150, 70))
    d.ellipse([380, 40, 470, 130], fill=(250, 220, 60))
    d.rectangle([150, 220, 330, 360], fill=(190, 80, 60))
    d.polygon([(130, 220), (240, 130), (350, 220)], fill=(110, 40, 40))
    d.rectangle([220, 280, 260, 360], fill=(80, 50, 30))
    d.rectangle([170, 245, 205, 280], fill=(240, 240, 200))
    return img


def other():
    rng = random.Random(7)
    img = Image.new("RGB", (512, 512), (20, 20, 30))
    d = ImageDraw.Draw(img)
    for _ in range(120):
        x, y = rng.randrange(512), rng.randrange(512)
        r = rng.randrange(2, 14)
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(rng.randrange(120, 256) for _ in range(3)))
    return img


scene().save(HERE / "bank" / "scene.jpg", quality=92)
scene().resize((448, 448)).save(HERE / "probe" / "scene-resized.jpg", quality=70)
other().save(HERE / "probe" / "other.jpg", quality=92)
