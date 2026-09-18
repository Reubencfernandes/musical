"""Compile the existing performer sprites into a fixed dot grid for Flutter."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[1]
output = root / 'flutter_app/assets/performers'
output.mkdir(parents=True, exist_ok=True)
for name in ('saxophone', 'guitar', 'piano', 'drums'):
    source = Image.open(root / f'outputs/score-studio/public/performers/{name}.png').convert('RGBA')
    width, height = source.width // 4, source.height // 4
    poses = []
    for pose in range(16):
        x, y = pose % 4 * width, pose // 4 * height
        rgba = np.asarray(source.crop((x, y, x + width, y + height)).resize((512, 512)), dtype=float)
        alpha = np.clip((rgba[:, :, 3] - 32) / 223, 0, 1)
        if name == 'guitar':
            alpha *= np.clip((rgba[:, :, :3].mean(axis=2) - 24) / 231, 0, 1)
        coverage = np.asarray(Image.fromarray((alpha * 255).astype('uint8')).filter(ImageFilter.BoxBlur(4)))
        poses.append(coverage)
    dots = []
    for y in range(9, 504, 9):
        for x in range(9, 504, 9):
            values = [int(pose[y, x]) for pose in poses]
            if max(values) > 2:
                dots.append([x, y, *values])
    (output / f'{name}.json').write_text(json.dumps(dots, separators=(',', ':')))
    print(f'{name}: {len(dots)} fixed dots')
