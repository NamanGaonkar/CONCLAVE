import math
from PIL import Image, ImageDraw, ImageFilter

def create_icon():
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = 28
    radius = 110
    plate_box = [pad, pad, size - pad, size - pad]
    
    # Outer dark ember plate
    draw.rounded_rectangle(plate_box, radius=radius, fill=(12, 10, 7, 255), outline=(245, 175, 40, 240), width=10)
    draw.rounded_rectangle([pad + 12, pad + 12, size - pad - 12, size - pad - 12], radius=radius - 8, outline=(60, 45, 18, 180), width=4)

    # Center glowing Amber Hexagon
    cx, cy = size / 2, size / 2
    r = 150

    def hex_points(center_x, center_y, radius):
        pts = []
        for i in range(6):
            angle_deg = 60 * i - 30
            angle_rad = math.radians(angle_deg)
            pts.append((center_x + radius * math.cos(angle_rad), center_y + radius * math.sin(angle_rad)))
        return pts

    outer_hex = hex_points(cx, cy, r)
    mid_hex = hex_points(cx, cy, r - 32)

    # Glow layer
    glow_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.polygon(outer_hex, outline=(255, 160, 26, 200), width=24)
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(16))
    img.alpha_composite(glow_img)

    # Outer hex
    draw.polygon(outer_hex, outline=(255, 209, 92, 255), width=12)
    # Inner hex
    draw.polygon(mid_hex, fill=(24, 18, 10, 230), outline=(245, 175, 40, 220), width=8)

    # Core 4 isolated agent quadrants
    draw.line([(cx - 75, cy), (cx - 15, cy)], fill=(255, 209, 92, 255), width=6)
    draw.line([(cx + 15, cy), (cx + 75, cy)], fill=(255, 209, 92, 255), width=6)
    draw.line([(cx, cy - 75), (cx, cy - 15)], fill=(255, 209, 92, 255), width=6)
    draw.line([(cx, cy + 15), (cx, cy + 75)], fill=(255, 209, 92, 255), width=6)

    nodes = [(cx - 45, cy - 45), (cx + 45, cy - 45), (cx - 45, cy + 45), (cx + 45, cy + 45)]
    for nx, ny in nodes:
        draw.ellipse([nx - 12, ny - 12, nx + 12, ny + 12], fill=(255, 220, 110, 255), outline=(255, 160, 26, 255), width=4)

    # Center power core
    core = [(cx, cy - 18), (cx + 18, cy), (cx, cy + 18), (cx - 18, cy)]
    draw.polygon(core, fill=(255, 245, 200, 255), outline=(245, 175, 40, 255))

    icon_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
    icon_256.save("conclave.png", format="PNG")
    icon_256.save("conclave.ico", format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("Generated conclave.ico and conclave.png successfully.")

if __name__ == "__main__":
    create_icon()
