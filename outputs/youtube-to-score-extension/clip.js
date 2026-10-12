import {getClip, putClip, deleteClip, listClips} from './db.js';
import {transcribe, DEFAULT_SPACE} from './sheetsage.js';
import {clock} from './time.js';
import {readScore, arrange, toMusicXML, pickupUnits} from './score.js';
import {engrave, measureTimes, follow} from './sheet.js';
import {songInfo} from './title.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CREDIT = 'Transcribed by SheetSage';
const urls = [];
let clip = null;
let job = null;

// The engraved score: what was read, how it is set out, and what is on screen.
let native = null;
let timing = null;
let sheet = null;
let drawn = null;
let drawToken = 0;
let stopFollowing = () => {};
let xmlUrl = '';
let saveTimer = 0;
let drawTimer = 0;

/** Object URLs are made per render and released when the page re-renders. */
function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}

function safeName(text) {
  return (text || 'capture').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'capture';
}

function fileLink({name, blob}, label = name) {
  const a = document.createElement('a');
  a.href = blobUrl(blob);
  a.download = name;
  a.textContent = label;
  return a;
}

async function renderList() {
  const list = $('clips');
  list.replaceChildren();
  for (const c of await listClips()) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `clip.html?id=${c.id}`;
    if (c.id === clip?.id) a.setAttribute('aria-current', 'page');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.title || 'Untitled';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${clock(c.start)} · ${Math.round(c.seconds)} s${c.scored ? ' · scored' : ''}`;
    a.append(name, meta);
    li.append(a);
    list.append(li);
  }
  if (!list.children.length) {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = 'Nothing recorded yet.';
    list.append(li);
  }
}

// ---- the engraved score ------------------------------------------------------

function keyLabel(name, transpose) {
  const minor = name.endsWith('m');
  const tonic = (minor ? name.slice(0, -1) : name).replace('#', '♯').replace('b', '♭');
  return `${tonic} ${minor ? 'minor' : 'major'}${transpose ? ` (${transpose > 0 ? '+' : ''}${transpose})` : ''}`;
}

/** Puts the saved (or guessed) settings into the controls. */
function syncControls(arranged) {
  $('sheet-title').value = sheet.title;
  $('sheet-artist').value = sheet.artist;
  const canPiano = !arranged || arranged.hasChords;
  for (const button of document.querySelectorAll('[data-layout]')) {
    const layout = arranged ? arranged.layout : sheet.layout;
    button.setAttribute('aria-checked', String(button.dataset.layout === layout));
    if (button.dataset.layout === 'piano') {
      button.disabled = !canPiano;
      button.title = canPiano ? '' : 'SheetSage2 found no chords to write a left hand from.';
    }
  }
  $('sheet-hand').value = sheet.hand;
  $('sheet-hand').disabled = arranged ? arranged.layout !== 'piano' : sheet.layout !== 'piano';
  if (arranged) $('key-name').value = keyLabel(arranged.key.name, sheet.transpose);
  $('key-down').disabled = sheet.transpose <= -6;
  $('key-up').disabled = sheet.transpose >= 6;
  $('zoom-label').value = `${Math.round(sheet.zoom * 100)}%`;
  $('sheet').style.setProperty('--zoom', sheet.zoom);
  $('sheet-note').textContent = arranged?.layout === 'lead'
    ? 'Lead sheet: the melody SheetSage2 heard, with its chord symbols. Click a bar to play the recording from there.'
    : 'Piano: the melody SheetSage2 heard, over a left hand written from its chords. Click a bar to play the recording from there.';
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!clip) return;
    clip = {...clip, sheet: {...sheet}};
    putClip(clip).catch(() => {});
  }, 600);
}

function drawSoon(delay = 450) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(drawSheet, delay);
}

/** SheetSage2's own rendering, for scores the arranger cannot read. */
function showOriginalPages(result, reason) {
  $('sheet').replaceChildren();
  document.querySelector('.sheet-bar').classList.add('hidden');
  $('sheet-settings').classList.add('hidden');
  $('sheet-error').textContent = `${reason} Showing SheetSage2's own layout instead.`;
  $('sheet-error').classList.remove('hidden');
  $('pages').replaceChildren(...result.pages.filter(Boolean).map((page, i) => {
    const img = document.createElement('img');
    img.src = blobUrl(page.blob);
    img.alt = `Score page ${i + 1}`;
    return img;
  }));
}

async function setupSheet(result) {
  const token = ++drawToken;
  stopFollowing();
  $('pages').replaceChildren();
  $('sheet-error').classList.add('hidden');
  document.querySelector('.sheet-bar').classList.remove('hidden');
  $('sheet-settings').classList.remove('hidden');
  try {
    native = readScore(result.abc);
  } catch (err) {
    native = null;
    showOriginalPages(result, 'This score could not be re-engraved.');
    return;
  }
  const files = result.files.filter(Boolean);
  const text = async (name) => (await files.find((f) => f.name === name)?.blob.text()) || '';
  let report = {};
  try { report = JSON.parse(await text('result.json') || '{}'); } catch {}
  const downbeats = (await text('downbeat.lab')).split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (token !== drawToken) return;
  timing = {pickup: pickupUnits(report.diagnostics, native.grid), downbeats, duration: report.duration_seconds || clip.seconds};
  const guess = songInfo(clip.title, clip.channel);
  sheet = {title: guess.title, artist: guess.artist, layout: 'piano', hand: 'pattern', transpose: 0, zoom: 1, ...clip.sheet};
  syncControls(null);
  await drawSheet();
}

async function drawSheet() {
  if (!native || !sheet) return;
  const token = ++drawToken;
  stopFollowing();
  stopFollowing = () => {};
  const container = $('sheet');
  container.setAttribute('aria-busy', 'true');
  try {
    const arranged = arrange(native, {layout: sheet.layout, accompaniment: sheet.hand, transpose: sheet.transpose, pickup: timing.pickup});
    const header = {title: sheet.title.trim() || 'Untitled', composer: sheet.artist.trim(), credit: CREDIT};
    const xml = toMusicXML(arranged, {title: header.title, composer: header.composer, arranger: CREDIT});
    const svgs = await engrave(xml, header);
    if (token !== drawToken) return;
    container.replaceChildren(...svgs.map((svg, i) => {
      const page = document.createElement('div');
      page.className = 'page';
      // Verovio's SVG is built here from our own MusicXML, with every text escaped.
      page.innerHTML = svg;
      if (i) page.append(Object.assign(document.createElement('span'), {className: 'page-number', textContent: String(i + 1)}));
      return page;
    }));
    drawn = {svgs, xml, header};
    if (xmlUrl) URL.revokeObjectURL(xmlUrl);
    xmlUrl = URL.createObjectURL(new Blob([xml], {type: 'application/vnd.recordare.musicxml+xml'}));
    $('sheet-xml').href = xmlUrl;
    $('sheet-xml').download = `${safeName(header.title)}.musicxml`;
    syncControls(arranged);
    if (timing.downbeats.length) {
      const times = measureTimes(arranged.measures, timing.downbeats, timing.duration);
      stopFollowing = follow(container, times, [$('player'), $('preview')], {onSeek: (audio) => audio.play().catch(() => {})});
    }
  } catch (err) {
    if (token !== drawToken) return;
    showOriginalPages(clip.result, `This score could not be engraved (${err.message}).`);
  } finally {
    if (token === drawToken) container.setAttribute('aria-busy', 'false');
  }
}

function renderResult(result) {
  $('result').classList.toggle('hidden', !result);
  if (!result) return;
  // Keep only what the Space adds after its stock "Finished … Download your files below." line.
  const warning = result.status.replace(/^Finished in [^.]*\.\s*(Download your files below\.)?\s*/, '');
  $('result-note').textContent = `Transcribed ${new Date(result.at).toLocaleString()}${warning ? ` · ${warning}` : ''}`;

  const main = $('main-files');
  main.replaceChildren();
  const byName = (n) => result.files.find((f) => f?.name === n);
  const picks = [
    [byName('transcription.mid'), 'MIDI'],
    [byName('score.abc'), 'ABC'],
    [result.files.find((f) => f?.name.endsWith('.zip')), 'All SheetSage2 files (ZIP)'],
  ];
  for (const [file, label] of picks) {
    if (!file) continue;
    const a = fileLink(file, label);
    a.className = 'button';
    main.append(a);
  }

  $('preview-wrap').classList.toggle('hidden', !result.preview);
  if (result.preview) $('preview').src = blobUrl(result.preview.blob);

  $('abc').textContent = result.abc || 'No ABC notation was returned.';
  const files = result.files.filter(Boolean);
  $('file-count').textContent = files.length;
  $('files').replaceChildren(...files.map((f) => {
    const li = document.createElement('li');
    li.append(fileLink(f));
    return li;
  }));
  setupSheet(result);
}

function render() {
  urls.splice(0).forEach(URL.revokeObjectURL);
  $('empty').classList.toggle('hidden', !!clip);
  $('clip').classList.toggle('hidden', !clip);
  if (!clip) return;

  document.title = `${clip.title || 'Capture'} · YouTube to Score`;
  $('title').textContent = clip.title || 'Untitled capture';
  $('range').textContent = `${clock(clip.start)}–${clock(clip.start + clip.seconds)} · ${Math.round(clip.seconds)} s`;
  const source = new URL(clip.url);
  source.searchParams.set('t', `${Math.floor(clip.start)}s`);
  $('source').href = source.href;

  const audio = blobUrl(clip.audio);
  $('player').src = audio;
  $('download-mp3').href = audio;
  $('download-mp3').download = `${safeName(clip.title)} (${clock(clip.start).replace(/:/g, '.')}).mp3`;

  $('melody').checked = clip.options?.melody ?? false;
  $('piano').checked = clip.options?.piano ?? true;
  const tooShort = clip.seconds < 5;
  $('transcribe').disabled = tooShort;
  $('transcribe').textContent = clip.result ? 'Transcribe again' : 'Transcribe with SheetSage2';
  if (tooShort) setStatus('SheetSage2 needs at least 5 seconds. Record a longer stretch.');
  renderResult(clip.result);
}

function setStatus(text, busy = false) {
  $('status').textContent = text;
  $('status').classList.toggle('busy', busy);
}

function setError(text) {
  $('error').textContent = text || '';
  $('error').classList.toggle('hidden', !text);
}

async function run() {
  if (job || !clip) return;
  setError('');
  const {space, token} = await chrome.storage.local.get(['space', 'token']);
  const controller = new AbortController();
  const started = Date.now();
  let label = 'Starting';
  const timer = setInterval(() => setStatus(`${label} · ${clock((Date.now() - started) / 1000)}`, true), 1000);
  job = controller;
  $('transcribe').disabled = true;
  $('abort').classList.remove('hidden');
  setStatus(label, true);
  try {
    const options = {melody: $('melody').checked, piano: $('piano').checked};
    const result = await transcribe({
      space: space || DEFAULT_SPACE,
      token,
      blob: clip.audio,
      filename: `${safeName(clip.title)}.mp3`,
      seconds: clip.seconds,
      melodyOnly: options.melody,
      piano: options.piano,
      signal: controller.signal,
      onStatus: (text) => { label = text; setStatus(`${label} · ${clock((Date.now() - started) / 1000)}`, true); },
    });
    clip = {...clip, options: {...clip.options, ...options}, result: {...result, at: Date.now()}};
    await putClip(clip);
    render();
    renderList();
    setStatus(`Done in ${clock((Date.now() - started) / 1000)}`);
    $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (err) {
    setStatus('');
    if (err.name !== 'AbortError') {
      setError(err instanceof TypeError
        ? `Could not reach the Space (${err.message}). Check your connection and the Space name in the extension settings.`
        : err.message);
    }
  } finally {
    clearInterval(timer);
    job = null;
    $('transcribe').disabled = clip.seconds < 5;
    $('abort').classList.add('hidden');
  }
}

async function init() {
  const id = params.get('id');
  clip = id ? await getClip(id) : null;
  if (!clip && !id) {
    const [latest] = await listClips();
    if (latest) {
      history.replaceState(null, '', `clip.html?id=${latest.id}`);
      clip = await getClip(latest.id);
    }
  }
  render();
  renderList();
  if (clip && params.get('auto') === '1' && clip.seconds >= 5) {
    history.replaceState(null, '', `clip.html?id=${clip.id}`);
    run();
  }
}

// ---- controls -----------------------------------------------------------------

$('transcribe').addEventListener('click', run);
$('abort').addEventListener('click', () => job?.abort());
$('copy-abc').addEventListener('click', async () => {
  await navigator.clipboard.writeText(clip?.result?.abc || '');
  $('copy-abc').textContent = 'Copied';
  setTimeout(() => { $('copy-abc').textContent = 'Copy ABC'; }, 1500);
});
$('delete').addEventListener('click', async () => {
  if (!clip) return;
  job?.abort();
  await deleteClip(clip.id);
  location.replace('clip.html');
});

for (const [id, field] of [['sheet-title', 'title'], ['sheet-artist', 'artist']]) {
  $(id).addEventListener('input', () => {
    if (!sheet) return;
    sheet[field] = $(id).value;
    saveSoon();
    drawSoon();
  });
}
for (const button of document.querySelectorAll('[data-layout]')) {
  button.addEventListener('click', () => {
    if (!sheet || sheet.layout === button.dataset.layout) return;
    sheet.layout = button.dataset.layout;
    saveSoon();
    drawSheet();
  });
}
$('sheet-hand').addEventListener('change', () => {
  sheet.hand = $('sheet-hand').value;
  saveSoon();
  drawSheet();
});
for (const [id, step] of [['key-down', -1], ['key-up', 1]]) {
  $(id).addEventListener('click', () => {
    sheet.transpose = Math.max(-6, Math.min(6, sheet.transpose + step));
    saveSoon();
    drawSheet();
  });
}
for (const [id, step] of [['zoom-out', -0.1], ['zoom-in', 0.1]]) {
  $(id).addEventListener('click', () => {
    sheet.zoom = Math.round(Math.max(0.6, Math.min(1.6, sheet.zoom + step)) * 10) / 10;
    syncControls(null);
    saveSoon();
  });
}

// Play along: the original recording drives the highlighted bar.
const player = $('player');
$('sheet-play').addEventListener('click', () => (player.paused ? player.play() : player.pause()));
const playState = () => {
  const playing = !player.paused;
  $('sheet-play').setAttribute('aria-pressed', String(playing));
  document.querySelector('#sheet-play .play-text').textContent = playing ? 'Pause' : 'Play along';
};
player.addEventListener('play', playState);
player.addEventListener('pause', playState);
player.addEventListener('timeupdate', () => {
  $('sheet-time').textContent = `${clock(player.currentTime)} / ${clock(player.duration || clip?.seconds || 0)}`;
});

// Printing (and Save as PDF) uses clean copies of the pages, named after the song.
let titleBeforePrint = '';
$('sheet-print').addEventListener('click', () => window.print());
addEventListener('beforeprint', () => {
  if (!drawn) return;
  $('print-root').replaceChildren(...drawn.svgs.map((svg, i) => {
    const page = document.createElement('div');
    page.className = 'print-page';
    page.innerHTML = svg;
    if (i) page.append(Object.assign(document.createElement('span'), {className: 'page-number', textContent: String(i + 1)}));
    return page;
  }));
  titleBeforePrint = document.title;
  document.title = safeName([drawn.header.title, drawn.header.composer].filter(Boolean).join(' - '));
});
addEventListener('afterprint', () => {
  $('print-root').replaceChildren();
  if (titleBeforePrint) document.title = titleBeforePrint;
});

init();
