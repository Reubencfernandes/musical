// Score Studio's dot-grid graphics: animated performers, waveforms and the
// clip timeline, drawn as dots on a fixed grid in the page's accent colour.

const POSE_COUNT = 16;
const LOOP_SECONDS = 5.7;
const PERFORMERS = ['saxophone', 'guitar', 'piano', 'drums'];

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const colour = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/** Sizes a canvas's backing store to its CSS box at up to 2× pixels. */
function fit(canvas) {
  const {width, height} = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return {ctx, width, height};
}

function dot(ctx, x, y, r) {
  if (r < 0.08) return;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Smooth slopes between poses, so the loop never stops at an illustrated pose (lib/performers.ts).
function coverageAt(poses, position) {
  const index = Math.floor(position);
  const t = position - index;
  const n = poses.length;
  const p0 = poses[(index + n - 1) % n], p1 = poses[index % n], p2 = poses[(index + 1) % n], p3 = poses[(index + 2) % n];
  const value = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  return Math.max(0, Math.min(1, value));
}

let performerData = null;
function performers() {
  // The sprite sheets sampled offline onto the app's 512 px grid at 9 px spacing.
  performerData ??= fetch('performers.json').then((r) => r.json()).then((data) => {
    const decode = (b64) => Float32Array.from(atob(b64), (c) => c.charCodeAt(0) / 255);
    const out = {grid: data.grid};
    for (const [name, dots] of Object.entries(data.performers)) out[name] = dots.map(([x, y, poses]) => ({x, y, poses: decode(poses)}));
    return out;
  });
  return performerData;
}

/** A musician animated by dots growing and shrinking on a fixed grid. Returns a stop function. */
export function animatePerformer(canvas, name = PERFORMERS[Math.floor(Math.random() * PERFORMERS.length)]) {
  let frame = 0;
  let stopped = false;
  canvas.dataset.performer = name;
  performers().then((data) => {
    if (stopped) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = data.grid * scale;
    canvas.height = data.grid * scale;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const began = performance.now();
    const draw = (now) => {
      if (stopped) return;
      const seconds = reduced() ? 0 : (now - began) / 1000;
      const position = (seconds / LOOP_SECONDS % 1) * POSE_COUNT;
      ctx.clearRect(0, 0, data.grid, data.grid);
      ctx.fillStyle = colour(canvas, '--accent', '#fb5729');
      for (const d of data[name]) dot(ctx, d.x, d.y, 3.35 * Math.sqrt(coverageAt(d.poses, position)));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  }).catch(() => canvas.classList.add('hidden'));
  return () => { stopped = true; cancelAnimationFrame(frame); };
}

/**
 * A live waveform on the dot grid, animated at 30 fps like Score Studio's job
 * waveform: columns scroll left and swell with the sound level `level()`
 * (0–1), and breathe gently while the level is low. Returns a stop function.
 */
export function animateWave(canvas, level) {
  const spacing = 6;
  const step = 0.06; // seconds per column as the wave scrolls
  let frame = 0;
  let last = -Infinity;
  let smooth = 0;
  let shift = 0;
  let size = null;
  const history = [];
  const began = performance.now();
  const draw = (now) => {
    frame = requestAnimationFrame(draw);
    if (now - last < 1000 / 30) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    const box = canvas.getBoundingClientRect();
    if (!size || size.width !== box.width || size.height !== box.height) size = fit(canvas);
    const {ctx, width, height} = size;
    const columns = Math.floor(width / spacing) + 1;
    const target = Math.max(0, Math.min(1, level() || 0));
    // Rise quickly with the music, fall back slowly, as a level meter does.
    smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
    const still = reduced();
    if (!still) shift += dt / step;
    while (shift >= 1 || history.length < columns) {
      history.push(smooth);
      if (history.length > columns) history.shift();
      if (shift >= 1) shift -= 1;
    }
    const seconds = still ? 0 : (now - began) / 1000;
    const mid = height / 2;
    const rows = Math.floor((mid - 3) / spacing);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colour(canvas, '--accent', '#fb5729');
    for (let i = 0; i < columns; i++) {
      const x = (i - shift) * spacing + spacing / 2;
      // A slow swell and finer detail keep the wave alive even when quiet.
      const swell = 0.5 + 0.5 * Math.sin(i * 0.19 - seconds * 2.2);
      const detail = 0.5 + 0.5 * Math.sin(i * 0.47 + seconds * 4.4);
      const loud = history[i] ?? 0;
      const shape = 0.1 + 0.18 * (0.65 * swell + 0.35 * detail);
      const envelope = Math.min(1, shape + loud * (0.55 + 0.45 * (0.65 * swell + 0.35 * detail))) * (mid - 3);
      ctx.globalAlpha = 0.35 + 0.6 * Math.min(1, loud * 1.6 + 0.15);
      for (let row = -rows; row <= rows; row++) {
        const coverage = Math.max(0, Math.min(1, (envelope - Math.abs(row * spacing)) / spacing + 0.5));
        dot(ctx, x, mid + row * spacing, 2.05 * Math.sqrt(coverage));
      }
    }
    ctx.globalAlpha = 1;
  };
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

/** Recent levels (0–1, oldest first) as columns of dots around a centre line. */
export function drawWave(canvas, levels, progress = 1) {
  const {ctx, width, height} = fit(canvas);
  const spacing = 6;
  const mid = height / 2;
  const rows = Math.floor((mid - 3) / spacing);
  const columns = Math.floor(width / spacing);
  ctx.fillStyle = colour(canvas, '--accent', '#fb5729');
  for (let i = 0; i < columns; i++) {
    const level = levels[levels.length - columns + i] ?? 0;
    const envelope = (0.08 + 0.92 * Math.min(1, level)) * (mid - 3);
    const x = i * spacing + spacing / 2;
    ctx.globalAlpha = x / width <= progress ? 0.9 : 0.3;
    for (let row = -rows; row <= rows; row++) {
      const coverage = Math.max(0, Math.min(1, (envelope - Math.abs(row * spacing)) / spacing + 0.5));
      dot(ctx, x, mid + row * spacing, 2.05 * Math.sqrt(coverage));
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The video as a band of dots: the chosen stretch lit in the accent colour,
 * chapter starts as small ticks, and the playhead in the text colour.
 */
export function drawTimeline(canvas, {duration, start, end, now, chapters = []}) {
  const {ctx, width, height} = fit(canvas);
  const spacing = 6;
  const columns = Math.floor(width / spacing);
  const mid = height / 2;
  const accent = colour(canvas, '--accent', '#fb5729');
  const ink = colour(canvas, '--ink', '#f5f4f2');
  const muted = colour(canvas, '--muted', '#a4a39f');
  const timeAt = (i) => ((i + 0.5) / columns) * duration;
  const chapterColumns = new Set(chapters.slice(1).map((c) => Math.floor((c.start / duration) * columns)));
  const playhead = now == null ? -1 : Math.min(columns - 1, Math.floor((now / duration) * columns));
  for (let i = 0; i < columns; i++) {
    const t = timeAt(i);
    const x = i * spacing + spacing / 2;
    const inside = t >= start && t <= end;
    if (i === playhead) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 1;
      for (const row of [-2, -1, 0, 1, 2]) dot(ctx, x, mid + row * spacing, 2.1);
      continue;
    }
    if (inside) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.95;
      for (const row of [-1, 0, 1]) dot(ctx, x, mid + row * spacing, 2.1);
    } else {
      ctx.fillStyle = muted;
      ctx.globalAlpha = 0.4;
      dot(ctx, x, mid, 1.6);
    }
    if (chapterColumns.has(i)) {
      ctx.fillStyle = muted;
      ctx.globalAlpha = 0.8;
      for (const row of [-2, 2]) dot(ctx, x, mid + row * spacing, 1.4);
    }
  }
  ctx.globalAlpha = 1;
}
