import {getClip, putClip, deleteClip, listClips} from './db.js';
import {transcribe, DEFAULT_SPACE} from './sheetsage.js';
import {clock} from './time.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const urls = [];
let clip = null;
let job = null;

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
    [result.pdf, 'Download PDF'],
    [byName('transcription.mid'), 'MIDI'],
    [byName('score.abc'), 'ABC'],
    [result.files.find((f) => f?.name.endsWith('.zip')), 'All files (ZIP)'],
  ];
  for (const [file, label] of picks) {
    if (!file) continue;
    const a = fileLink(file, label);
    a.className = main.children.length ? 'button' : 'button primary';
    main.append(a);
  }

  $('pages').replaceChildren(...result.pages.filter(Boolean).map((page, i) => {
    const img = document.createElement('img');
    img.src = blobUrl(page.blob);
    img.alt = `Score page ${i + 1}`;
    return img;
  }));

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

init();
