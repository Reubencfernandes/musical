"""Draw the Kiku AI mark and write every icon the projects ship.

The mark is a bold pixel K on the orange tile: square pixels on a fixed grid,
in the same language as the dot-matrix musicians. In the apps its pixels drop
in when it appears and a wave runs through them every few seconds. Icons of
32 px and under use a plainer K whose pixels land exactly on the pixel grid,
so they stay crisp.

Run from the repository root:  python branding/generate.py
Needs Pillow. Every output is overwritten.
"""
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP, BOTTOM = (255, 133, 64), (242, 84, 28)   # tile gradient, around the app's #ff7133 accent
CREAM = (255, 245, 236)

# Each K: its grid, the [column, row] cells that are lit, and in tile units
# (the tile spanning 0..1) the pitch between pixels, a pixel's size and its corner radius.
LARGE = {'cols': 6, 'rows': 7, 'pitch': 0.10, 'pixel': 0.09, 'round': 0.012, 'cells': [
    [0, 0], [1, 0], [4, 0], [5, 0],
    [0, 1], [1, 1], [3, 1], [4, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 3], [1, 3], [2, 3],
    [0, 4], [1, 4], [2, 4], [3, 4],
    [0, 5], [1, 5], [3, 5], [4, 5],
    [0, 6], [1, 6], [4, 6], [5, 6],
]}
# At 16 px each pixel is exactly 2 px, and at 32 px exactly 4 px.
SMALL = {'cols': 4, 'rows': 5, 'pitch': 0.125, 'pixel': 0.125, 'round': 0, 'cells': [
    [0, 0], [3, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2],
    [0, 3], [2, 3],
    [0, 4], [3, 4],
]}

SS = 8  # supersampling for antialiased edges


def boxes(k):
    """Each lit pixel as (left, top, size, radius) in tile units, the K centred on the tile."""
    left = 0.5 - ((k['cols'] - 1) * k['pitch'] + k['pixel']) / 2
    top = 0.5 - ((k['rows'] - 1) * k['pitch'] + k['pixel']) / 2
    return [(left + x * k['pitch'], top + y * k['pitch'], k['pixel'], k['round']) for x, y in k['cells']]


def gradient(size):
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        draw.line([(0, y), (size, y)], fill=tuple(round(TOP[c] + (BOTTOM[c] - TOP[c]) * t) for c in range(3)))
    return img


def pixels_layer(size, k, off, tile):
    layer = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(layer)
    for x, y, s, r in boxes(k):
        X, Y, S = off + x * tile, off + y * tile, s * tile
        box = [round(X), round(Y), round(X + S) - 1, round(Y + S) - 1]
        if r:
            draw.rounded_rectangle(box, radius=r * tile, fill=255)
        else:
            draw.rectangle(box, fill=255)
    return layer


def icon(px, k, shape='rounded', inset=0.0, radius=0.235, color=CREAM, glyph_scale=1.0):
    """One icon at px pixels. shape: 'rounded' tile, 'square' (full bleed), or 'none' (glyph only)."""
    S = px * SS
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    body = S * (1 - 2 * inset)
    off = S * inset
    if shape != 'none':
        mask = Image.new('L', (S, S), 0)
        if shape == 'square':
            mask.paste(255, [0, 0, S, S])
        else:
            ImageDraw.Draw(mask).rounded_rectangle([off, off, off + body - 1, off + body - 1], radius=body * radius, fill=255)
        out.paste(gradient(S).convert('RGBA'), (0, 0), mask)
    glyph_tile = body * glyph_scale
    glyph = pixels_layer(S, k, off + (body - glyph_tile) / 2, glyph_tile)
    out.paste(Image.new('RGBA', (S, S), color + (255,)), (0, 0), glyph)
    return out.resize((px, px), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def svg(k, tile=True, current_color=False, size=512):
    """An SVG of the mark on a 100-unit canvas."""
    fill = 'currentColor' if current_color else '#%02x%02x%02x' % CREAM
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}" role="img" aria-label="Kiku AI"'
             + (' shape-rendering="crispEdges"' if not k['round'] else '') + '>']
    if tile:
        parts.append('<defs><linearGradient id="kiku-tile" x1="0" y1="0" x2="0" y2="1">'
                     f'<stop offset="0" stop-color="#{TOP[0]:02x}{TOP[1]:02x}{TOP[2]:02x}"/>'
                     f'<stop offset="1" stop-color="#{BOTTOM[0]:02x}{BOTTOM[1]:02x}{BOTTOM[2]:02x}"/></linearGradient></defs>')
        parts.append('<rect width="100" height="100" rx="23.5" fill="url(#kiku-tile)" shape-rendering="geometricPrecision"/>')
    parts.append(f'<g fill="{fill}">')
    for x, y, s, r in boxes(k):
        corner = f' rx="{r * 100:g}"' if r else ''
        parts.append(f'<rect x="{x * 100:g}" y="{y * 100:g}" width="{s * 100:g}" height="{s * 100:g}"{corner}/>')
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
                   'pixels': '#%02x%02x%02x' % CREAM}, f, separators=(',', ':'))
        f.write('\n')

    # Chrome extension toolbar and store icons
    for px in (16, 32, 48, 128):
        save(icon(px, SMALL if px <= 32 else LARGE), 'outputs', 'youtube-to-score-extension', 'icons', f'{px}.png')

    # Kiku AI web app: favicon (Next.js serves app/icon.svg), the Apple touch icon, and the animated mark's cells
    write(svg(SMALL, size=32), 'outputs', 'kiku-ai', 'app', 'icon.svg')
    save(icon(180, LARGE, shape='square'), 'outputs', 'kiku-ai', 'app', 'apple-icon.png')
    cells = lambda k: '[' + ','.join(f'[{x},{y}]' for x, y in k['cells']) + ']'
    write('// Generated by branding/generate.py. The pixel K: [column, row] cells on its grid.\n'
          f'export const K={{cols:{LARGE["cols"]},rows:{LARGE["rows"]},cells:{cells(LARGE)} as [number,number][]}};\n',
          'outputs', 'kiku-ai', 'components', 'logo-pixels.ts')

    # Flutter app
    app = ('kiku_app',)
    darts = lambda k: '[' + ', '.join(f'[{x}, {y}]' for x, y in k['cells']) + ']'
    write('// Generated by branding/generate.py. The pixel K: [column, row] cells on its grid.\n\n'
          f'const int kikuCols = {LARGE["cols"]};\n'
          f'const int kikuRows = {LARGE["rows"]};\n'
          f'const List<List<int>> kikuCells = {darts(LARGE)};\n',
          *app, 'lib', 'ui', 'logo_pixels.g.dart')
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
