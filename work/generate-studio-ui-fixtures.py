"""Local, synthetic audio for checking the studio UI without private recordings."""
import math
import random
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parent / 'studio-ui-fixtures'
root.mkdir(exist_ok=True)
rate, seconds = 16000, 72
random.seed(14)
for name, kind in [('Vocal sketch', 'voice'), ('Electric guitar', 'guitar')]:
    samples = bytearray()
    notes = [196, 220, 261.63, 246.94, 220, 196, 174.61, 196]
    texture = [random.uniform(0.15, 1) for _ in range(int(seconds / 0.035) + 2)]
    events = [(0, 0.4)]
    at = 0
    while at < seconds:
        at += random.choice([0.125, 0.25, 0.375, 0.5])
        events.append((at, random.uniform(0.18, 0.8)))
    event_index = 0
    for i in range(rate * seconds):
        t = i / rate
        frequency = notes[int(t / 2) % len(notes)]
        detail = t / 0.035
        index = int(detail)
        amplitude = texture[index] * (1 - detail % 1) + texture[index + 1] * (detail % 1)
        if kind == 'voice':
            phrase = t % 5.5
            envelope = min(1, phrase * 4) * min(1, (5.1 - phrase) * 3) if phrase < 5.1 else 0
            syllable = (0.3 + 0.7 * abs(math.sin(t * 3.7))) * amplitude
            vibrato = math.sin(t * 31) * 0.01
            sample = envelope * syllable * (math.sin(t * 2 * math.pi * frequency + vibrato) * 0.5 + math.sin(t * 2 * math.pi * frequency * 2) * 0.11)
        else:
            while event_index + 1 < len(events) and t >= events[event_index + 1][0]:
                event_index += 1
            attack = t - events[event_index][0]
            envelope = (0.12 + events[event_index][1] * math.exp(-attack * 8)) * (0.4 + 0.6 * amplitude)
            sample = envelope * sum(math.sin(t * 2 * math.pi * frequency * harmonic) / harmonic for harmonic in [1, 2, 3, 4, 5]) * 0.48
            sample += random.uniform(-0.025, 0.025) * envelope
        samples.extend(struct.pack('<h', int(max(-1, min(1, sample)) * 32767)))
    with wave.open(str(root / f'{name}.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(samples)
print('Created two synthetic 72-second audio fixtures.')
