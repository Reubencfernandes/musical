"""Draw the Kiku AI mark and write every icon the projects ship.

The mark is a chrysanthemum (kiku, 菊) of dots that swirls like sound (kiku,
聞く, "to listen"): a centre dot and three rings whose dot sizes rise and fall
around each ring, so six curved petals appear out of a plain dot grid. It is
drawn in the same language as the dot-matrix musicians: fixed positions,
changing radii. It replaces the earlier dotted "K" with an accent dot, which
read too close to Kimi's logo.

Run from the repository root:  python branding/generate.py
Needs Pillow. Every output is overwritten.
"""
import json
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP, BOTTOM = (255, 133, 64), (242, 84, 28)   # tile gradient, around the app's #ff7133 accent
CREAM = (255, 245, 236)
INK = (17, 17, 20)


def bloom(rings, depth, center, twist, petals=6):
    """Dots as (x, y, radius) in tile units, the tile spanning -0.5..0.5."""
    dots = [(0.0, 0.0, center)] if center else []
    for j, (count, radius, size) in enumerate(rings):
        for i in range(count):
            a = -math.pi / 2 + 2 * math.pi * (i + 0.5 * (j % 2)) / count + twist * j
            swell = (1 - depth) + depth * (0.5 + 0.5 * math.cos(petals * (a - twist * j + math.pi / 2)))
            dots.append((radius * math.cos(a), radius * math.sin(a), size * swell))
    return [(round(x, 5), round(y, 5), round(r, 5)) for x, y, r in dots]


# The full mark, and a simpler one with fewer, larger dots for 16 and 32 px.
LARGE = bloom([(6, 0.135, 0.05), (12, 0.24, 0.058), (18, 0.345, 0.056)], depth=0.78, center=0.055, twist=0.28)
SMALL = bloom([(6, 0.17, 0.075), (12, 0.33, 0.08)], depth=0.7, center=0.085, twist=0.3)

SS = 8  # supersampling for antialiased edges


def gradient(size):
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        draw.line([(0, y), (size, y)], fill=tuple(round(TOP[c] + (BOTTOM[c] - TOP[c]) * t) for c in range(3)))
    return img


def dots_layer(size, dots, color, cx, cy, tile):
    layer = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(layer)
    for x, y, r in dots:
        X, Y, R = cx + x * tile, cy + y * tile, r * tile
        draw.ellipse([X - R, Y - R, X + R, Y + R], fill=255)
    return layer


def icon(px, dots, shape='rounded', inset=0.0, radius=0.235, background=True, color=CREAM, glyph_scale=1.0):
    """One icon at px pixels. shape: 'rounded' tile, 'square' (full bleed), or 'none' (glyph only)."""
    S = px * SS
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    body = S * (1 - 2 * inset)
    off = S * inset
    if background and shape != 'none':
        mask = Image.new('L', (S, S), 0)
        if shape == 'square':
            mask.paste(255, [0, 0, S, S])
        else:
            ImageDraw.Draw(mask).rounded_rectangle([off, off, off + body - 1, off + body - 1], radius=body * radius, fill=255)
        out.paste(gradient(S).convert('RGBA'), (0, 0), mask)
    glyph = dots_layer(S, dots, color, S / 2, S / 2, body * glyph_scale)
    out.paste(Image.new('RGBA', (S, S), color + (255,)), (0, 0), glyph)
    return out.resize((px, px), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def svg(dots, tile=True, current_color=False, size=512):
    """An SVG of the mark on a 100-unit canvas."""
    fill = 'currentColor' if current_color else '#%02x%02x%02x' % CREAM
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}" role="img" aria-label="Kiku AI">']
    if tile:
        parts.append('<defs><linearGradient id="kiku-tile" x1="0" y1="0" x2="0" y2="1">'
                     f'<stop offset="0" stop-color="#{TOP[0]:02x}{TOP[1]:02x}{TOP[2]:02x}"/>'
                     f'<stop offset="1" stop-color="#{BOTTOM[0]:02x}{BOTTOM[1]:02x}{BOTTOM[2]:02x}"/></linearGradient></defs>')
        parts.append('<rect width="100" height="100" rx="23.5" fill="url(#kiku-tile)"/>')
    parts.append(f'<g fill="{fill}">')
    for x, y, r in dots:
        parts.append(f'<circle cx="{50 + x * 100:.2f}" cy="{50 + y * 100:.2f}" r="{r * 100:.2f}"/>')
    parts.append('</g></svg>')
    return ''.join(parts) + '\n'


def write(text, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def main():
    # Masters
    write(svg(LARGE), 'branding', 'kiku-mark.svg')
    write(svg(SMALL), 'branding', 'kiku-mark-small.svg')
    write(svg(LARGE, tile=False, current_color=True), 'branding', 'kiku-glyph.svg')
    save(icon(512, LARGE), 'branding', 'kiku-mark.png')
    save(icon(1024, LARGE, shape='square'), 'branding', 'kiku-mark-square-1024.png')
    with open(os.path.join(ROOT, 'branding', 'kiku-mark.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'large': LARGE, 'small': SMALL, 'top': '#%02x%02x%02x' % TOP, 'bottom': '#%02x%02x%02x' % BOTTOM,
                   'dots': '#%02x%02x%02x' % CREAM}, f, separators=(',', ':'))
        f.write('\n')

    # Chrome extension toolbar and store icons
    for px in (16, 32, 48, 128):
        save(icon(px, SMALL if px <= 32 else LARGE), 'outputs', 'youtube-to-score-extension', 'icons', f'{px}.png')

    # Kiku AI web app: favicon (Next.js serves app/icon.svg) and the Apple touch icon
    write(svg(SMALL, size=32), 'outputs', 'kiku-ai', 'app', 'icon.svg')
    save(icon(180, LARGE, shape='square'), 'outputs', 'kiku-ai', 'app', 'apple-icon.png')
    dots = lambda d: '[' + ','.join(f'[{x},{y},{r}]' for x, y, r in d) + ']'
    write('// Generated by branding/generate.py. Dots as [x, y, radius] on a tile spanning -0.5..0.5.\n'
          f'export const LARGE:[number,number,number][]={dots(LARGE)};\n'
          f'export const SMALL:[number,number,number][]={dots(SMALL)};\n',
          'outputs', 'kiku-ai', 'components', 'logo-dots.ts')

    # Flutter app
    app = ('kiku_app',)
    darts = lambda d: '[' + ', '.join(f'[{x}, {y}, {r}]' for x, y, r in d) + ']'
    write('// Generated by branding/generate.py. Dots as [x, y, radius] on a tile\n'
          '// spanning -0.5..0.5.\n\n'
          f'const List<List<double>> kikuLargeDots = {darts(LARGE)};\n\n'
          f'const List<List<double>> kikuSmallDots = {darts(SMALL)};\n',
          *app, 'lib', 'ui', 'logo_dots.g.dart')
    for folder, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        save(icon(px, LARGE, inset=0.04), *app, 'android', 'app', 'src', 'main', 'res', f'mipmap-{folder}', 'ic_launcher.png')
        # Adaptive icon foreground: 108 dp canvas, the glyph inside the 66 dp safe circle.
        fg = round(px * 108 / 48)
        save(icon(fg, LARGE, shape='none', glyph_scale=0.72), *app, 'android', 'app', 'src', 'main', 'res', f'mipmap-{folder}', 'ic_launcher_foreground.png')
    ios = {'Icon-App-20x20@1x.png': 20, 'Icon-App-20x20@2x.png': 40, 'Icon-App-20x20@3x.png': 60,
           'Icon-App-29x29@1x.png': 29, 'Icon-App-29x29@2x.png': 58, 'Icon-App-29x29@3x.png': 87,
           'Icon-App-40x40@1x.png': 40, 'Icon-App-40x40@2x.png': 80, 'Icon-App-40x40@3x.png': 120,
           'Icon-App-60x60@2x.png': 120, 'Icon-App-60x60@3x.png': 180, 'Icon-App-76x76@1x.png': 76,
           'Icon-App-76x76@2x.png': 152, 'Icon-App-83.5x83.5@2x.png': 167, 'Icon-App-1024x1024@1x.png': 1024}
    for name, px in ios.items():
        # iOS masks the corners itself and rejects transparency.
        save(icon(px, SMALL if px <= 40 else LARGE, shape='square').convert('RGB'), *app, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset', name)
    for px in (16, 32, 64, 128, 256, 512, 1024):
        # macOS icons sit on the standard grid: an 824/1024 body with room around it.
        save(icon(px, SMALL if px <= 32 else LARGE, inset=100 / 1024, radius=0.225), *app, 'macos', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset', f'app_icon_{px}.png')
    save(icon(256, LARGE), *app, 'assets', 'kiku-mark.png')
    print('Wrote the Kiku AI mark and icons.')


if __name__ == '__main__':
    main()
