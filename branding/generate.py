"""Generate the Kiku listening mark and every shipped brand icon.

The custom receiver, swept sound ribbons and listening point share one vector
source across SVG, React and Flutter. App icons put the orange mark on warm ink;
the in-app mark is freestanding. Run with Python + Pillow from any directory.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TOP, BOTTOM = (255, 134, 74), (242, 77, 36)
TILE_TOP, TILE_BOTTOM = (42, 35, 31), (23, 22, 21)
SS = 4

# Coordinates on a 100-unit artboard. The three ribbons open around the point.
PARTS = {
    'receiver': [('M',34,17),('C',24,17,17,24,17,34),('L',17,66),
                 ('C',17,76,24,83,34,83),('L',40,83),('L',40,68),('L',35,68),
                 ('C',33,68,32,66,32,64),('L',32,36),('C',32,34,33,32,35,32),
                 ('L',40,32),('L',40,17),('Z',)],
    'upper': [('M',44,38),('C',55,35,63,28,69,17),('L',85,23),
              ('C',77,40,64,48,44,49),('Z',)],
    'lower': [('M',44,55),('C',64,55,78,64,87,77),('L',70,83),
              ('C',64,72,56,65,44,65),('Z',)],
}
SIGNAL = {'x': 39, 'y': 51, 'radius': 3.6}


def path_data(commands):
    return ' '.join(command[0] + ' '.join(str(n) for n in command[1:]) for command in commands)


def sampled_path(commands):
    points, current = [], (0, 0)
    for command in commands:
        name, *values = command
        if name in ('M', 'L'):
            current = tuple(values)
            points.append(current)
        elif name == 'C':
            start = current
            for step in range(1, 33):
                t = step / 32
                current = tuple((1-t)**3 * start[i] + 3*(1-t)**2*t*values[i]
                                + 3*(1-t)*t*t*values[i+2] + t**3*values[i+4] for i in range(2))
                points.append(current)
    return points


def gradient(size, top, bottom):
    image = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size-1)
        draw.line([(0,y),(size,y)], fill=tuple(round(top[c]+(bottom[c]-top[c])*t) for c in range(3)))
    return image


def icon(px, shape='rounded', inset=0, radius=.235, glyph_scale=1):
    size = px * SS
    image = Image.new('RGBA', (size,size))
    body, offset = size*(1-2*inset), size*inset
    if shape != 'none':
        mask = Image.new('L', (size,size))
        draw = ImageDraw.Draw(mask)
        if shape == 'square':
            draw.rectangle((0,0,size,size), fill=255)
        else:
            draw.rounded_rectangle((offset,offset,offset+body-1,offset+body-1), radius=body*radius, fill=255)
        image.paste(gradient(size,TILE_TOP,TILE_BOTTOM).convert('RGBA'), (0,0), mask)
    scale = body*glyph_scale/100
    origin = offset + (body-body*glyph_scale)/2
    mask = Image.new('L', (size,size))
    draw = ImageDraw.Draw(mask)
    for commands in PARTS.values():
        draw.polygon([(origin+x*scale, origin+y*scale) for x,y in sampled_path(commands)], fill=255)
    x,y,r = SIGNAL.values()
    draw.ellipse((origin+(x-r)*scale,origin+(y-r)*scale,origin+(x+r)*scale,origin+(y+r)*scale), fill=255)
    image.paste(gradient(size,TOP,BOTTOM).convert('RGBA'), (0,0), mask)
    return image.resize((px,px), Image.Resampling.LANCZOS)


def hex_color(rgb):
    return '#%02x%02x%02x' % rgb


def svg(tile=True, current_color=False, size=512):
    fills = [('kiku-ink',TOP,BOTTOM),('kiku-tile',TILE_TOP,TILE_BOTTOM)]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}" role="img" aria-label="Kiku AI"><defs>']
    for name,top,bottom in fills:
        parts.append(f'<linearGradient id="{name}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop stop-color="{hex_color(top)}"/><stop offset="1" stop-color="{hex_color(bottom)}"/></linearGradient>')
    parts.append('</defs>')
    if tile:
        parts.append('<rect width="100" height="100" rx="23.5" fill="url(#kiku-tile)"/>')
    parts.append(f'<g fill="{"currentColor" if current_color else "url(#kiku-ink)"}">')
    parts += [f'<path d="{path_data(commands)}"/>' for commands in PARTS.values()]
    parts.append(f'<circle cx="{SIGNAL["x"]}" cy="{SIGNAL["y"]}" r="{SIGNAL["radius"]}"/></g></svg>\n')
    return ''.join(parts)


def write(text, *parts):
    path = ROOT.joinpath(*parts)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(text,encoding='utf-8',newline='\n')


def save(image, *parts):
    path = ROOT.joinpath(*parts)
    path.parent.mkdir(parents=True,exist_ok=True)
    image.save(path,optimize=True)


def main():
    mark = {name:path_data(commands) for name,commands in PARTS.items()}
    mark['signal'] = SIGNAL
    write(json.dumps(mark,separators=(',',':'))+'\n','branding','kiku-mark.json')
    write(svg(),'branding','kiku-mark.svg')
    write(svg(size=32),'branding','kiku-mark-small.svg')
    write(svg(tile=False,current_color=True),'branding','kiku-glyph.svg')
    save(icon(512),'branding','kiku-mark.png')
    save(icon(1024,shape='square'),'branding','kiku-mark-square-1024.png')
    for px in (16,32,48,128):
        save(icon(px),'outputs','youtube-to-score-extension','icons',f'{px}.png')

    web = ('outputs','kiku-ai')
    write(svg(size=32),*web,'app','icon.svg')
    save(icon(180,shape='square'),*web,'app','apple-icon.png')
    write('// Generated by branding/generate.py. Shared listening-mark vector geometry.\n'
          +'export const KIKU_MARK='+json.dumps(mark,separators=(',',':'))+' as const;\n',
          *web,'components','logo-mark.ts')

    app = ('kiku_app',)
    methods = {'M':'moveTo','L':'lineTo','C':'cubicTo','Z':'close'}
    dart = "// Generated by branding/generate.py. Shared listening-mark vector geometry.\nimport 'dart:ui';\n\n"
    for name,commands in PARTS.items():
        dart += 'Path kiku'+name.title()+'Path() => Path()\n'
        dart += '\n'.join('  ..'+methods[c[0]]+'('+', '.join(str(v) for v in c[1:])+')' for c in commands)+';\n\n'
    dart += f'const kikuSignal = Offset({SIGNAL["x"]}, {SIGNAL["y"]});\nconst kikuSignalRadius = {SIGNAL["radius"]};\n'
    write(dart,*app,'lib','ui','logo_mark.g.dart')
    write('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n'
          f'    <gradient android:angle="270" android:startColor="{hex_color(TILE_TOP)}" android:endColor="{hex_color(TILE_BOTTOM)}"/>\n</shape>\n',
          *app,'android','app','src','main','res','drawable','ic_launcher_background.xml')
    for folder,px in {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}.items():
        target = (*app,'android','app','src','main','res',f'mipmap-{folder}')
        save(icon(px,inset=.04),*target,'ic_launcher.png')
        save(icon(round(px*108/48),shape='none',glyph_scale=.72),*target,'ic_launcher_foreground.png')
    ios = {'20x20@1x':20,'20x20@2x':40,'20x20@3x':60,'29x29@1x':29,'29x29@2x':58,'29x29@3x':87,
           '40x40@1x':40,'40x40@2x':80,'40x40@3x':120,'60x60@2x':120,'60x60@3x':180,
           '76x76@1x':76,'76x76@2x':152,'83.5x83.5@2x':167,'1024x1024@1x':1024}
    for name,px in ios.items():
        save(icon(px,shape='square').convert('RGB'),*app,'ios','Runner','Assets.xcassets','AppIcon.appiconset',f'Icon-App-{name}.png')
    for px in (16,32,64,128,256,512,1024):
        save(icon(px,inset=100/1024,radius=.225),*app,'macos','Runner','Assets.xcassets','AppIcon.appiconset',f'app_icon_{px}.png')
    save(icon(256,shape='none'),*app,'assets','kiku-mark.png')
    print('Wrote the Kiku listening mark, shared vectors and all shipped icons.')


if __name__ == '__main__':
    main()
