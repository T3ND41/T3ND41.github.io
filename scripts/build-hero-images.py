"""Build faithful, responsive hero derivatives from the original photo."""

from pathlib import Path
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "assets" / "img"


def export(source: str, stem: str, width: int) -> None:
    with Image.open(IMAGES / source) as image:
        image = image.convert("RGB")
        height = round(image.height * width / image.width)
        image = image.resize((width, height), Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.15, percent=105, threshold=3))
        image.save(IMAGES / f"{stem}.webp", "WEBP", quality=82, method=6)
        image.save(IMAGES / f"{stem}.jpg", "JPEG", quality=84, progressive=True, optimize=True, subsampling=0)
        print(f"{stem}: {width}×{height}")


if __name__ == "__main__":
    export("hero-team.jpg", "hero-team-2048", 2048)
    export("hero-team-sm.jpg", "hero-team-mobile-1140", 1140)
