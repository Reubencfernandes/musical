from pathlib import Path
import importlib.util
import math
import struct
import wave

root = Path(__file__).resolve().parent
audio = root / 'test-melody.wav'
# A generated C-major melody, used only to check the conversion pipeline.
rate = 24000
notes = [60, 62, 64, 65, 67, 67, 69, 67, 65, 64, 62, 60]
samples = []
for note in notes:
    frequency = 440 * 2 ** ((note - 69) / 12)
    for i in range(rate // 2):
        t = i / rate
        envelope = min(1, t * 50) * math.exp(-3 * t) * min(1, (0.5-t)*50)
        v = sum(math.sin(2*math.pi*frequency*h*t)/h**2 for h in range(1, 5))
        samples.append(int(12000 * envelope * v))
# Leave silence at the end so the final note does not touch the clip boundary.
samples.extend([0] * rate * 2)
with wave.open(str(audio), 'wb') as stream:
    stream.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    stream.writeframes(struct.pack('<'+'h'*len(samples), *samples))
print(f'Generated test audio: {audio}')

spec = importlib.util.spec_from_file_location('score_app', root.parent / 'outputs/sheetsage2-space/app.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
for values in [(None, 0, 30, False, False), (str(audio), -1, 30, False, False),
               (str(audio), 0, 601, False, False)]:
    try:
        next(app.transcribe(*values))
        raise AssertionError('Expected validation error')
    except app.gr.Error:
        pass
print('PASS: missing file, invalid start and excessive duration rejected.')
assert app.demo.config['dependencies'][0]['api_name'] == 'transcribe'
print('PASS: UI constructs and exposes queued conversion endpoint.')
