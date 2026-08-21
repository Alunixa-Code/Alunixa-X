#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
ICON_DIR = ROOT / "apps" / "alunixa-x-manager" / "src-tauri" / "icons"
S = 4
SIZE = 1024
CANVAS = SIZE * S

def sc(value):
    return int(value * S)

def gradient_background(size):
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            nx = x / size
            ny = y / size
            glow = max(0.0, 1.0 - math.hypot(nx - 0.74, ny - 0.22) * 1.45)
            glow2 = max(0.0, 1.0 - math.hypot(nx - 0.18, ny - 0.82) * 1.6)
            r = int(7 + 16 * glow + 4 * glow2)
            g = int(14 + 24 * glow + 18 * glow2)
            b = int(31 + 54 * glow + 48 * glow2)
            pixels[x, y] = (r, g, b, 255)
    return image

def line_glow(base, points, color, width, glow_color=None):
    glow_color = glow_color or color
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line(points, fill=(*glow_color, 165), width=width * 3, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(width * 1.45))
    base.alpha_composite(glow)
    d = ImageDraw.Draw(base)
    d.line(points, fill=(*color, 255), width=width, joint="curve")


def build_icon():
    background = gradient_background(CANVAS)
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (sc(52), sc(52), sc(972), sc(972)),
        radius=sc(228),
        fill=255,
    )
    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(background, (0, 0), mask)

    border = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle(
        (sc(56), sc(56), sc(968), sc(968)),
        radius=sc(224),
        outline=(123, 146, 255, 105),
        width=sc(5),
    )
    bd.rounded_rectangle(
        (sc(74), sc(74), sc(950), sc(950)),
        radius=sc(208),
        outline=(255, 255, 255, 22),
        width=sc(2),
    )
    icon.alpha_composite(border)

    orbit = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(orbit)
    box = (sc(145), sc(275), sc(875), sc(745))
    for offset, alpha in [(30, 20), (20, 35), (10, 70)]:
        od.arc(tuple(v-offset for v in box[:2]) + tuple(v+offset for v in box[2:]), 194, 525, fill=(55, 220, 255, alpha), width=sc(8))
    od.arc(box, 194, 349, fill=(66, 222, 255, 235), width=sc(14))
    od.arc(box, 349, 525, fill=(145, 108, 255, 235), width=sc(14))
    orbit = orbit.rotate(-17, resample=Image.Resampling.BICUBIC, center=(CANVAS//2, CANVAS//2))
    icon.alpha_composite(orbit)

    # The A is a launch vector; the X is the crossing agent rail.
    line_glow(icon, [(sc(272), sc(733)), (sc(442), sc(290)), (sc(612), sc(733))], (230, 249, 255), sc(54), (62, 218, 255))
    line_glow(icon, [(sc(351), sc(553)), (sc(538), sc(553))], (72, 222, 255), sc(42), (72, 222, 255))
    line_glow(icon, [(sc(592), sc(382)), (sc(790), sc(696))], (156, 119, 255), sc(50), (137, 102, 255))
    line_glow(icon, [(sc(787), sc(382)), (sc(603), sc(696))], (112, 204, 255), sc(50), (82, 202, 255))

    node = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    nd = ImageDraw.Draw(node)
    nd.ellipse((sc(794), sc(243), sc(864), sc(313)), fill=(79, 222, 255, 85))
    node = node.filter(ImageFilter.GaussianBlur(sc(18)))
    icon.alpha_composite(node)
    ImageDraw.Draw(icon).ellipse((sc(809), sc(258), sc(849), sc(298)), fill=(236, 253, 255, 255), outline=(91, 224, 255, 255), width=sc(6))

    icon = icon.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    icon.save(BRAND / "alunixa-x-icon.png", optimize=True)
    icon.save(ICON_DIR / "icon.png", optimize=True)
    sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
    icon.save(ICON_DIR / "icon.ico", format="ICO", sizes=sizes)
    return icon


def build_social(icon):
    width, height = 1280, 640
    image = Image.new("RGBA", (width, height), (5, 11, 26, 255))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / height
        draw.line((0, y, width, y), fill=(6 + int(7*t), 13 + int(14*t), 31 + int(30*t), 255))
    glow = Image.new("RGBA", image.size, (0,0,0,0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((700, -260, 1450, 490), fill=(93, 84, 255, 75))
    gd.ellipse((-270, 330, 480, 1080), fill=(36, 202, 255, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(110))
    image.alpha_composite(glow)
    image.alpha_composite(icon.resize((360,360), Image.Resampling.LANCZOS), (110, 140))
    try:
        display = ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 78)
        body = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 30)
        mono = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 22)
    except OSError:
        display = body = mono = ImageFont.load_default()
    draw = ImageDraw.Draw(image)
    draw.text((530, 184), "ALUNIXA X", font=display, fill=(243, 249, 255, 255))
    draw.text((535, 293), "AI Agent Control System", font=body, fill=(126, 218, 255, 255))
    draw.text((536, 354), "Models  ·  Providers  ·  Tools  ·  Automation", font=mono, fill=(174, 184, 216, 255))
    draw.rounded_rectangle((534, 424, 805, 478), radius=27, fill=(90, 100, 255, 42), outline=(111, 207, 255, 105), width=2)
    draw.text((567, 438), "BUILD YOUR AGENT RAIL", font=mono, fill=(227, 245, 255, 255))
    image.convert("RGB").save(BRAND / "alunixa-x-social.png", quality=94, optimize=True)

if __name__ == "__main__":
    BRAND.mkdir(parents=True, exist_ok=True)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    build_social(icon)
    print(BRAND / "alunixa-x-icon.png")
    print(BRAND / "alunixa-x-social.png")
    print(ICON_DIR / "icon.ico")
