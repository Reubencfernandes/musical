// Records the captured tab's audio straight into MP3 while the tab keeps
// playing out loud. Only audio heard while the video itself plays is kept.
import {putClip} from './db.js';

const KBPS = 192;
const MIN_SECONDS = 1;
// Any website (meta.free) has no player to say when the music plays, so the
// recording starts with the first block louder than this (about -50 dB).
const SOUND = 0.003;
let rec = null;

const send = (msg) => chrome.runtime.sendMessage({target: 'background', ...msg}).catch(() => {});

function toPcm(samples, count) {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function start({streamId, seconds, meta}) {
  if (rec) throw new Error('A recording is already running.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}},
    video: false,
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('recorder-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  // Capturing a tab mutes it, so route the audio back out to the speakers.
  source.connect(ctx.destination);
  const tap = new AudioWorkletNode(ctx, 'tap', {channelCount: 2, channelCountMode: 'explicit'});
  source.connect(tap);
  tap.connect(ctx.destination); // the tap outputs silence; this keeps it rendering

  rec = {
    stream, ctx, tap, meta,
    encoder: new lamejs.Mp3Encoder(2, ctx.sampleRate, KBPS),
    chunks: [],
    live: false,
    free: !!meta.free,
    frames: 0,
    target: Math.round(seconds * ctx.sampleRate),
    peak: 0,
    ticker: setInterval(tick, 250),
  };
  tap.port.onmessage = ({data: [left, right]}) => take(left, right);
  stream.getAudioTracks()[0].addEventListener('ended', () => finish());
}

const loud = (samples) => samples.some((s) => Math.abs(s) > SOUND);

function take(left, right) {
  if (rec?.free && !rec.live && (loud(left) || loud(right))) rec.live = true;
  if (!rec?.live) return;
  const count = Math.min(left.length, rec.target - rec.frames);
  if (count <= 0) return;
  for (let i = 0; i < count; i++) rec.peak = Math.max(rec.peak, Math.abs(left[i]), Math.abs(right[i]));
  const mp3 = rec.encoder.encodeBuffer(toPcm(left, count), toPcm(right, count));
  if (mp3.length) rec.chunks.push(mp3);
  rec.frames += count;
  if (rec.frames >= rec.target) finish();
}

function tick() {
  if (!rec) return;
  send({type: 'tick', captured: rec.frames / rec.ctx.sampleRate, peak: rec.peak, ...(rec.free && {live: rec.live})});
  rec.peak = 0;
}

function teardown() {
  if (!rec) return null;
  const done = rec;
  rec = null;
  clearInterval(done.ticker);
  done.tap.port.onmessage = null;
  done.stream.getTracks().forEach((track) => track.stop());
  done.ctx.close().catch(() => {});
  return done;
}

async function finish() {
  const done = teardown();
  if (!done) return;
  const seconds = done.frames / done.ctx.sampleRate;
  if (seconds < MIN_SECONDS) {
    send({type: 'failed', error: done.free
      ? 'Nothing was heard. Play the music in the tab after you press Record.'
      : 'Nothing was recorded. Make sure the video plays after you press Record.'});
    return;
  }
  const tail = done.encoder.flush();
  if (tail.length) done.chunks.push(tail);
  const clip = {
    ...done.meta,
    id: crypto.randomUUID(),
    seconds,
    created: Date.now(),
    audio: new Blob(done.chunks, {type: 'audio/mpeg'}),
  };
  try {
    await putClip(clip);
    send({type: 'captured', id: clip.id, seconds});
  } catch (err) {
    send({type: 'failed', error: `Could not save the recording: ${err.message}`});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // The YouTube tab broadcasts whether the video is audible right now.
  if (msg.type === 'gate') {
    if (rec && !rec.free) rec.live = msg.live;
    return;
  }
  if (msg.target !== 'offscreen') return;
  switch (msg.type) {
    case 'record':
      start(msg).then(() => reply({ok: true}), (err) => { teardown(); reply({error: err.message}); });
      return true;
    case 'finish':
      finish();
      reply({ok: true});
      return;
    case 'cancel':
      teardown();
      reply({ok: true});
      return;
  }
});
