from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SIZE = 1024
OUT_DIR = Path(__file__).resolve().parents[1] / "apps" / "desktop" / "build"
FONT_PATH = "C:/Windows/Fonts/segoeuib.ttf"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    cream = (244, 245, 241, 255)
    dark = (23, 50, 77, 255)
    amber = (247, 176, 75, 255)

    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=230, fill=cream)

    try:
        font = ImageFont.truetype(FONT_PATH, 560)
    except OSError:
        font = ImageFont.load_default()

    text = "bf"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = (SIZE - text_width) / 2 - bbox[0]
    text_y = (SIZE - text_height) / 2 - bbox[1] - 38
    draw.text((text_x, text_y), text, font=font, fill=dark)

    underline_width = 340
    underline_height = 48
    underline_x = (SIZE - underline_width) / 2
    underline_y = SIZE - 250
    draw.rounded_rectangle(
        (
            underline_x,
            underline_y,
            underline_x + underline_width,
            underline_y + underline_height,
        ),
        radius=24,
        fill=amber,
    )

    icon_path = OUT_DIR / "icon.png"
    ico_path = OUT_DIR / "icon.ico"

    image.resize((512, 512), Image.Resampling.LANCZOS).save(icon_path)
    image.save(
        ico_path,
        format="ICO",
        sizes=[
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
    print(icon_path)
    print(ico_path)


if __name__ == "__main__":
    main()
