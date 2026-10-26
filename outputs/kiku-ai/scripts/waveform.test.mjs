// Run with Node 24+: node --test scripts/waveform.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {waveformEnvelope, waveformWindow, WAVE_WINDOW} from '../lib/studio/waveform.ts';

function audio(channels, sampleRate = 256) {
  const data = channels.map(channel => Float32Array.from(channel));
  assert.ok(data.every(channel => channel.length === data[0].length));
  return {
    length: data[0].length,
    numberOfChannels: data.length,
    sampleRate,
    duration: data[0].length / sampleRate,
    getChannelData: index => data[index],
  };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);
}

test('opposite-phase stereo retains both peaks and its audible energy', () => {
  const buffer = audio([Array(1024).fill(.6), Array(1024).fill(-.6)]);
  const envelope = waveformEnvelope(buffer, 0, buffer.duration, 4);
  for (let column = 0; column < 4; column++) {
    near(envelope[column * 3], -.6, 'negative peak');
    near(envelope[column * 3 + 1], .6, 'positive peak');
    near(envelope[column * 3 + 2], .6, 'RMS must not cancel channels');
  }
});

test('single-sample transients survive a far zoomed-out view', () => {
  const samples = new Float32Array(96000);
  samples[113] = .9;
  samples[63999] = -.8;
  const buffer = audio([samples], 48000);
  const envelope = waveformEnvelope(buffer, 0, buffer.duration, 12);
  near(envelope[1], .9, 'short positive transient');
  near(envelope[7 * 3], -.8, 'short negative transient');
  near(envelope[2], .9 / Math.sqrt(8000), 'positive transient energy');
  near(envelope[7 * 3 + 2], .8 / Math.sqrt(8000), 'negative transient energy');
});

test('silence remains silent instead of acquiring decorative amplitude', () => {
  const buffer = audio([new Float32Array(2048), new Float32Array(2048)]);
  const envelope = waveformEnvelope(buffer, .25, 6, 73);
  assert.equal(envelope.length, 73 * 3);
  assert.ok(envelope.every(value => value === 0));
});

test('trimming a clip excludes transients on both sides of the selected source range', () => {
  const samples = new Float32Array(256);
  samples[20] = 1;
  samples[240] = -1;
  const buffer = audio([samples]);
  const envelope = waveformEnvelope(buffer, 64 / 256, 128 / 256, 8);
  assert.ok(envelope.every(value => value === 0), `cropped silence contained ${Array.from(envelope)}`);
});

test('the last rounded display column stops at the clip trim without shifting earlier columns', () => {
  const samples = new Float32Array(256);
  samples[113] = .5;
  samples[164] = .4;
  samples[165] = -1; // The first sample trimmed away from the clip.
  const buffer = audio([samples]);
  // A 101px clip on a 2.5px grid requests 41 columns spanning 102.5px.
  // The crop ends at source sample 165 even though the last grid cell extends past it.
  const untrimmed = waveformEnvelope(buffer, 64 / 256, 102.5 / 256, 41);
  const trimmed = waveformEnvelope(buffer, 64 / 256, 102.5 / 256, 41, 165 / 256);
  assert.deepEqual(trimmed.slice(0, -3), untrimmed.slice(0, -3), 'earlier columns must retain their source intervals');
  near(untrimmed.at(-3), -1, 'fixture must contain an out-of-clip transient');
  near(trimmed.at(-3), 0, 'trimmed transient is excluded');
  near(trimmed.at(-2), .4, 'last in-clip sample is preserved');
  near(trimmed.at(-1), .4, 'last column RMS measures only the retained source');
});

test('high zoom keeps adjacent samples in their own display columns', () => {
  const buffer = audio([[0, 1, 0, 0, -1, 0]], 6);
  const envelope = waveformEnvelope(buffer, 0, 1, 6);
  assert.deepEqual(Array.from(envelope), [
    0, 0, 0,
    0, 1, 1,
    0, 0, 0,
    0, 0, 0,
    -1, 0, 1,
    0, 0, 0,
  ]);
});

test('RMS measures each column and averages channel power before taking its square root', () => {
  const buffer = audio([
    [...Array(128).fill(.8), ...Array(128).fill(.2)],
    [...Array(128).fill(-.4), ...Array(128).fill(-.1)],
  ]);
  const envelope = waveformEnvelope(buffer, 0, 1, 2);
  near(envelope[0], -.4, 'first negative peak');
  near(envelope[1], .8, 'first positive peak');
  near(envelope[2], Math.sqrt((.8 ** 2 + .4 ** 2) / 2), 'first column RMS');
  near(envelope[3], -.1, 'second negative peak');
  near(envelope[4], .2, 'second positive peak');
  near(envelope[5], Math.sqrt((.2 ** 2 + .1 ** 2) / 2), 'second column RMS');
});

test('a partially filled final source block receives its actual sample weight', () => {
  const samples = new Float32Array(301);
  samples[300] = 1;
  const buffer = audio([samples]);
  const envelope = waveformEnvelope(buffer, 0, buffer.duration, 1);
  near(envelope[1], 1, 'final sample peak');
  near(envelope[2], 1 / Math.sqrt(301), 'final sample energy');
});

test('invalid sample values do not poison peaks or energy', () => {
  const buffer = audio([[NaN, Infinity, -Infinity, .5]]);
  const envelope = waveformEnvelope(buffer, 0, buffer.duration, 1);
  near(envelope[0], 0, 'minimum');
  near(envelope[1], .5, 'maximum');
  near(envelope[2], .25, 'RMS with invalid values treated as silence');
});

test('empty, invalid, and out-of-source display ranges do not produce audio', () => {
  const buffer = audio([Array(512).fill(.75)]);
  assert.equal(waveformEnvelope(buffer, 0, buffer.duration, 0).length, 0);
  assert.equal(waveformEnvelope(buffer, 0, buffer.duration, NaN).length, 0);
  for (const [offset, duration] of [[0, 0], [0, -1], [NaN, 1], [0, Infinity], [8, 1], [-8, 1]]) {
    assert.ok(waveformEnvelope(buffer, offset, duration, 10).every(value => value === 0));
  }
});

test('a day-long clip allocates only a bounded viewport window at every scroll position', () => {
  const left = 733;
  const width = 24 * 60 * 60 * 240;
  const viewWidth = 1173;
  for (const scrollLeft of [0, 1, 511, 512, 1023, 50000, width / 2, width - 512, width + left]) {
    // Arrangement batches scroll updates at this resolution; the extra overscan
    // must cover the actual viewport until the next update arrives.
    const viewLeft = Math.floor(scrollLeft / WAVE_WINDOW) * WAVE_WINDOW;
    const window = waveformWindow(left, width, viewLeft, viewWidth);
    assert.ok(window.start >= 0 && window.start <= width);
    assert.ok(window.width >= 0 && window.width <= viewWidth + WAVE_WINDOW * 3);
    assert.ok(window.start + window.width <= width);
    const visibleStart = Math.max(left, scrollLeft);
    const visibleEnd = Math.min(left + width, scrollLeft + viewWidth);
    if (visibleEnd > visibleStart) {
      assert.ok(left + window.start <= visibleStart, 'visible beginning must be drawn');
      assert.ok(left + window.start + window.width >= visibleEnd, 'visible end must be drawn');
    }
  }
});

test('clips outside the overscan region receive no waveform columns', () => {
  assert.equal(waveformWindow(100000, 5000, 0, 900).width, 0);
  assert.equal(waveformWindow(0, 5000, 100000, 900).width, 0);
});
