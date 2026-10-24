import {getClip, putClip, deleteClip, listClips} from './db.js';
import {transcribe, DEFAULT_SPACE} from './sheetsage.js';
import {clock} from './time.js';
import {readScore, readEvents, arrange, toMusicXML, pickupUnits} from './score.js';
import {engrave, barAt, Highlighter, measureTimes, AI_NOTE} from './sheet.js';
import {scorePdf} from './pdf.js';
import {SheetPlayer, performance as perform} from './playback.js';
import {animatePerformer} from './dots.js';
import {songInfo} from './title.js';
import {renderLetters, lettersText} from './letters.js';
import {spaceToken} from './hf-auth.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Shown in Chrome's side panel beside the video, or full size in a tab.
const inPanel = params.get('panel') === '1';
const here = (query = {}) => `clip.html?${new URLSearchParams({...query, ...(inPanel ? {panel: '1'} : {})})}`;
if (inPanel) {
  document.body.classList.add('in-panel');
  // If this capture was opened in the panel from a tab, the toolbar icon should still open the record view next time.
  chrome.sidePanel?.setOptions({path: 'popup.html'}).catch(() => {});
}
const CREDIT = 'AI transcription by SheetSage2';
const urls = [];
let clip = null;
let job = null;
let stopPerformer = null;

// The engraved score: what was read, how it is set out, and what is on screen.
let native = null;
let timing = null;
let sheet = null;
let drawn = null;
let drawToken = 0;
let highlighter = null;
let xmlUrl = '';
let textUrl = '';
let litNote = null;
let printed = false;
let saveTimer = 0;
let drawTimer = 0;

const player = new SheetPlayer();

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

const icon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);

/** A capture's delete button: the first click asks, a second within 3 seconds deletes. */
function deleteButton(c) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'clip-delete';
  button.title = 'Delete this capture';
  button.setAttribute('aria-label', `Delete ${c.title || 'this capture'}`);
  button.innerHTML = '<svg width="15" height="15" aria-hidden="true"><use href="#i-trash"/></svg>';
  let timer = 0;
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = 'Delete?';
      timer = setTimeout(() => {
        button.classList.remove('armed');
        button.innerHTML = '<svg width="15" height="15" aria-hidden="true"><use href="#i-trash"/></svg>';
      }, 3000);
      return;
    }
    clearTimeout(timer);
    if (c.id === clip?.id) job?.abort();
    await deleteClip(c.id);
    if (c.id === clip?.id) location.replace(here());
    else renderList();
  });
  return button;
}

const span = (className, text) => Object.assign(document.createElement('span'), {className, textContent: text});

/** The video's YouTube thumbnail, from the address the capture was made at. */
function thumbnail(url) {
  try {
    const id = new URL(url).searchParams.get('v');
    return id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
  } catch {
    return '';
  }
}

let clips = [];
async function renderList() {
  clips = await listClips();
  const count = String(clips.length || '');
  $('clip-count').textContent = count;
  $('tab-count').textContent = count;
  // Searching helps once the list is longer than a screen.
  $('search-wrap').classList.toggle('hidden', clips.length < 7);
  showList();
}

function showList() {
  const list = $('clips');
  const query = $('clip-search').value.trim().toLowerCase();
  const shown = [];
  for (const c of clips) {
    const guess = songInfo(c.title, c.channel);
    const title = (c.sheet?.title ?? guess.title).trim() || c.title || 'Untitled';
    const artist = (c.sheet?.artist ?? guess.artist).trim();
    if (query && ![title, artist, c.title].some((t) => t?.toLowerCase().includes(query))) continue;
    const a = document.createElement('a');
    a.href = here({id: c.id});
    a.title = c.title || title;
    if (c.id === clip?.id) a.setAttribute('aria-current', 'page');
    const thumb = span('thumb', '');
    const src = thumbnail(c.url);
    if (src) {
      const img = Object.assign(document.createElement('img'), {src, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer'});
      // A removed or private video has no thumbnail: leave the plain tile.
      img.addEventListener('error', () => img.remove());
      thumb.append(img);
    }
    thumb.append(span('length', clock(c.seconds)));
    const text = span('clip-text', '');
    text.append(span('name', title));
    if (artist) text.append(span('artist', artist));
    const meta = span('meta', `${clock(c.start)}–${clock(c.start + c.seconds)} · ${new Date(c.created).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}`);
    if (c.scored) meta.append(span('tag', 'Score'));
    text.append(meta);
    a.append(thumb, text);
    const li = document.createElement('li');
    li.className = 'clip-item';
    li.append(a, deleteButton(c));
    shown.push(li);
  }
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'clips-empty';
    li.textContent = query ? `No capture matches “${$('clip-search').value.trim()}”.`
      : 'Nothing recorded yet. Open a song on YouTube and record the part you want as sheet music.';
    shown.push(li);
  }
  list.replaceChildren(...shown);
}
$('clip-search').addEventListener('input', showList);

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
  const layout = arranged ? arranged.layout : sheet.layout;
  const letters = sheet.notation === 'letters';
  for (const button of document.querySelectorAll('[data-notation]')) button.setAttribute('aria-checked', String(button.dataset.notation === sheet.notation));
  for (const button of document.querySelectorAll('[data-layout]')) {
    button.setAttribute('aria-checked', String(button.dataset.layout === layout));
    // Letters spell out the tune only, so the staff layout does not apply to them.
    button.disabled = letters || (button.dataset.layout === 'piano' && arranged ? !arranged.hasChords : false);
    button.title = letters ? 'Letters show the tune and its chords; switch to Sheet music for a layout.'
      : button.disabled ? 'SheetSage2 found no chords to write a left hand from.' : '';
  }
  $('sheet-hand').value = sheet.hand;
  $('sheet-hand').disabled = letters || layout !== 'piano';
  $('download-pdf').classList.toggle('hidden', letters);
  if (arranged) $('key-name').value = keyLabel(arranged.key.name, sheet.transpose);
  $('key-down').disabled = sheet.transpose <= -6;
  $('key-up').disabled = sheet.transpose >= 6;
  $('zoom-label').value = `${Math.round(sheet.zoom * 100)}%`;
  $('sheet').style.setProperty('--zoom', sheet.zoom);
  $('track-title').textContent = sheet.title || 'Score';
  heading();
  $('sheet-note').textContent = letters
    ? 'Letters: the tune SheetSage2 heard as note names, with its chords above. Click a bar to play from there; Print makes a paper copy.'
    : layout === 'lead'
    ? 'Lead sheet: the tune SheetSage2 heard, with its chord symbols. Click a bar to play from there.'
    : 'Piano: the tune SheetSage2 heard, over a left hand written from its chords. Click a bar to play from there.';
}

/** The page heading: the song's title and artist, or the video title before there is a sheet. */
function heading() {
  if (!clip) return;
  const guess = songInfo(clip.title, clip.channel);
  const title = (sheet?.title ?? guess.title).trim() || clip.title || 'Untitled capture';
  const artist = (sheet?.artist ?? guess.artist).trim();
  $('title').textContent = title;
  $('title').title = clip.title || title;
  $('artist-line').textContent = artist;
  document.title = `${title} · YouTube to Score`;
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
  for (const el of document.querySelectorAll('.transport, .score-toolbar, #sheet-settings')) el.classList.add('hidden');
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
  $('pages').replaceChildren();
  $('sheet-error').classList.add('hidden');
  for (const el of document.querySelectorAll('.transport, .score-toolbar, #sheet-settings')) el.classList.remove('hidden');
  const files = result.files.filter(Boolean);
  const text = async (name) => (await files.find((f) => f.name === name)?.blob.text()) || '';
  // SheetSage2's ABC first; when its notation step failed, what the model heard (events.tsv).
  let pickup = null;
  try {
    native = readScore(result.abc);
  } catch {
    try {
      native = readEvents(await text('events.tsv'));
      pickup = native.pickup;
    } catch {
      native = null;
    }
  }
  if (token !== drawToken) return;
  if (!native) {
    showOriginalPages(result, 'This score could not be re-engraved.');
    return;
  }
  let report = {};
  try { report = JSON.parse(await text('result.json') || '{}'); } catch {}
  const downbeats = (await text('downbeat.lab')).split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (token !== drawToken) return;
  timing = {pickup: pickup ?? pickupUnits(report.diagnostics, native.grid), downbeats, duration: report.duration_seconds || clip.seconds};
  const guess = songInfo(clip.title, clip.channel);
  // New sheets show the music the way the reader last chose.
  const {notation} = await chrome.storage.local.get('notation');
  if (token !== drawToken) return;
  sheet = {title: guess.title, artist: guess.artist, layout: 'piano', hand: 'pattern', transpose: 0, zoom: 1, speed: 1, notation: notation || 'staff', ...clip.sheet};
  $('speed').value = String(sheet.speed);
  syncControls(null);
  await drawSheet();
}

async function drawSheet() {
  if (!native || !sheet) return;
  const token = ++drawToken;
  const container = $('sheet');
  container.setAttribute('aria-busy', 'true');
  try {
    const arranged = arrange(native, {layout: sheet.layout, accompaniment: sheet.hand, transpose: sheet.transpose, pickup: timing.pickup});
    const header = {title: sheet.title.trim() || 'Untitled', composer: sheet.artist.trim(), credit: CREDIT};
    const xml = toMusicXML(arranged, {title: header.title, composer: header.composer, arranger: CREDIT});
    const letters = sheet.notation === 'letters';
    const svgs = letters ? null : await engrave(xml, header);
    if (token !== drawToken) return;
    highlighter?.destroy();
    litNote = null;
    const words = {...header, note: AI_NOTE};
    if (letters) container.replaceChildren(renderLetters(arranged, words));
    else {
      container.replaceChildren(...svgs.map((svg, i) => {
        const page = document.createElement('div');
        page.className = 'page';
        // Verovio's SVG is built here from our own MusicXML, with every text escaped.
        page.innerHTML = svg;
        if (i) page.append(Object.assign(document.createElement('span'), {className: 'page-number', textContent: String(i + 1)}));
        return page;
      }));
    }
    highlighter = new Highlighter(container, {topInset: inPanel ? 124 : 96, selector: letters ? '.letter-bar' : 'svg g.measure'});
    highlighter.follow = $('follow').checked;
    drawn = {svgs, xml, header, arranged, letters};
    if (sync) await stopSync();
    await player.load(perform(arranged, sheet.speed));
    if (xmlUrl) URL.revokeObjectURL(xmlUrl);
    xmlUrl = URL.createObjectURL(new Blob([xml], {type: 'application/vnd.recordare.musicxml+xml'}));
    $('sheet-xml').href = xmlUrl;
    $('sheet-xml').download = `${safeName(header.title)}.musicxml`;
    if (textUrl) URL.revokeObjectURL(textUrl);
    textUrl = URL.createObjectURL(new Blob([lettersText(arranged, words)], {type: 'text/plain;charset=utf-8'}));
    $('letters-txt').href = textUrl;
    $('letters-txt').download = `${safeName(header.title)} (letter notes).txt`;
    syncControls(arranged);
    updateTransport();
    if (params.get('print') === '1' && !printed) {
      printed = true;
      setTimeout(() => window.print(), 300);
    }
  } catch (err) {
    if (token !== drawToken) return;
    showOriginalPages(clip.result, `This score could not be engraved (${err.message}).`);
  } finally {
    if (token === drawToken) container.setAttribute('aria-busy', 'false');
  }
}

// ---- playback ------------------------------------------------------------------

/** The bar being played, or -1. */
function litBar() {
  return player.piece && (player.playing || player.position > 0) ? barAt(player.piece.bars, player.position) : -1;
}

function updateTransport() {
  const total = player.duration;
  const at = player.position;
  $('progress-fill').style.width = total ? `${Math.min(100, (at / total) * 100)}%` : '0%';
  $('elapsed').textContent = clock(at);
  $('remaining').textContent = total ? `−${clock(Math.max(0, total - at))}` : 'SCORE';
  $('seek').max = String(total || 1);
  $('seek').value = String(Math.min(at, total || 1));
  $('play').setAttribute('aria-label', player.playing ? 'Pause score' : 'Play score');
  icon($('play'), player.playing ? 'pause' : 'play');
}

/** In letters, lights the note sounding at `time` (in the performance) inside bar `index`. */
function lightNote(index, time) {
  let note = null;
  const bar = drawn?.letters && index >= 0 ? player.piece?.bars[index] : null;
  if (bar) {
    const unit = ((time - bar.start) / (bar.end - bar.start)) * drawn.arranged.measures[index].length;
    note = [...(highlighter.measures[index]?.querySelectorAll('.ln:not(.rest)') ?? [])]
      .find((n) => unit >= Number(n.dataset.at) && unit < Number(n.dataset.at) + Number(n.dataset.units)) ?? null;
  }
  if (note === litNote) return;
  litNote?.classList.remove('on');
  note?.classList.add('on');
  litNote = note;
}

// One loop keeps the transport and the lit bar in step with the music.
(function frame() {
  if (player.playing) {
    updateTransport();
    const bar = litBar();
    highlighter?.show(bar);
    lightNote(bar, player.position);
  }
  requestAnimationFrame(frame);
})();

async function playSheet(at) {
  $('play').setAttribute('aria-busy', 'true');
  highlighter?.resume();
  try { await player.play(at); } finally { $('play').removeAttribute('aria-busy'); }
  updateTransport();
}

player.onend = () => { updateTransport(); highlighter?.clear(); lightNote(-1); };

// ---- page ----------------------------------------------------------------------

function renderResult(result) {
  $('result').classList.toggle('hidden', !result);
  if (!result) return;
  // Keep only what the Space adds after its stock "Finished … Download your files below." line.
  const warning = result.status.replace(/^Finished in [^.]*\.\s*(Download your files below\.)?\s*/, '');
  $('done').textContent = `Transcribed ${new Date(result.at).toLocaleString()}${warning ? ` · ${warning}` : ''}`;

  // SheetSage2's own files join the Download menu after the engraved score.
  const items = $('download-items');
  for (const el of items.querySelectorAll('.sheetsage')) el.remove();
  const byName = (n) => result.files.find((f) => f?.name === n);
  for (const [file, label] of [
    [byName('transcription.mid'), 'SheetSage2 · MIDI'],
    [byName('score.abc'), 'SheetSage2 · ABC'],
    [result.pdf, 'SheetSage2 · original PDF'],
    [result.files.find((f) => f?.name.endsWith('.zip')), 'SheetSage2 · all files (ZIP)'],
  ]) {
    if (!file) continue;
    const a = fileLink(file, label);
    a.className = 'sheetsage';
    items.append(a);
  }

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

  heading();
  $('range').textContent = `${clock(clip.start)}–${clock(clip.start + clip.seconds)} of the video`;
  const source = new URL(clip.url);
  source.searchParams.set('t', `${Math.floor(clip.start)}s`);
  $('source').href = source.href;

  const audio = blobUrl(clip.audio);
  $('download-mp3').href = audio;
  $('download-mp3').download = `${safeName(clip.title)} (${clock(clip.start).replace(/:/g, '.')}).mp3`;

  const tooShort = clip.seconds < 5;
  $('transcribe').disabled = tooShort;
  $('transcribe').textContent = clip.result ? 'Transcribe again' : 'Transcribe with SheetSage2';
  if (tooShort) $('done').textContent = 'SheetSage2 needs at least 5 seconds. Record a longer part.';
  renderResult(clip.result);
}

function setError(text) {
  $('error').textContent = text || '';
  $('error').classList.toggle('hidden', !text);
}

function busy(on) {
  $('processing').classList.toggle('hidden', !on);
  $('transcribe-row').classList.toggle('hidden', on);
  if (on) stopPerformer ??= animatePerformer($('performer'));
  else if (stopPerformer) { stopPerformer(); stopPerformer = null; }
}

async function run() {
  if (job || !clip) return;
  setError('');
  const token = await spaceToken();
  const controller = new AbortController();
  const started = Date.now();
  let label = 'Starting';
  const status = () => { $('status').textContent = `${label} · ${clock((Date.now() - started) / 1000)}`; };
  const timer = setInterval(status, 1000);
  job = controller;
  busy(true);
  status();
  try {
    const options = {melody: false, piano: false};
    const result = await transcribe({
      space: DEFAULT_SPACE,
      token,
      blob: clip.audio,
      filename: `${safeName(clip.title)}.mp3`,
      seconds: clip.seconds,
      melodyOnly: options.melody,
      piano: options.piano,
      signal: controller.signal,
      onStatus: (text) => { label = text; status(); },
    });
    clip = {...clip, options: {...clip.options, ...options}, result: {...result, at: Date.now()}};
    await putClip(clip);
    render();
    renderList();
    $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (err) {
    if (err.name !== 'AbortError') {
      setError(err instanceof TypeError
        ? `Could not reach SheetSage2 (${err.message}). Check your connection and try again.`
        : err.message);
    }
  } finally {
    clearInterval(timer);
    job = null;
    busy(false);
    $('transcribe').disabled = clip.seconds < 5;
  }
}

async function init() {
  const id = params.get('id');
  if (inPanel && !id) {
    // In the panel, Captures is a page of its own: the list.
    document.body.classList.add('list-view');
    document.title = 'Captures · YouTube to Score';
    await renderList();
    return;
  }
  clip = id ? await getClip(id) : null;
  if (!clip && !id) {
    const [latest] = await listClips();
    if (latest) {
      history.replaceState(null, '', here({id: latest.id}));
      clip = await getClip(latest.id);
    }
  }
  render();
  renderList();
  // Fresh captures transcribe on arrival; one that already has a score just shows it.
  if (clip && params.get('auto') === '1' && clip.seconds >= 5 && !clip.result) {
    history.replaceState(null, '', here({id: clip.id}));
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
  location.replace(here());
});

// In the side panel, score settings fold away until asked for.
$('settings-toggle').addEventListener('click', () => {
  const open = $('sheet-settings').classList.toggle('open');
  $('settings-toggle').setAttribute('aria-expanded', String(open));
});

// The captures sidebar on the full page: a drawer on narrow windows, else a
// column that can be closed (and remembered closed). The panel lists them on a page of their own.
const shell = document.querySelector('.shell');
const drawer = () => matchMedia('(max-width: 1000px)').matches;
const setDrawer = (open) => {
  $('sidebar').classList.toggle('open', open);
  $('sidebar-toggle').setAttribute('aria-expanded', String(open));
};
const setCollapsed = (closed) => {
  shell.classList.toggle('collapsed', closed);
  try { localStorage.setItem('captures-closed', closed ? '1' : ''); } catch {}
};
try { if (!inPanel && localStorage.getItem('captures-closed')) shell.classList.add('collapsed'); } catch {}
$('sidebar-toggle').addEventListener('click', () => {
  if (shell.classList.contains('collapsed') && !drawer()) setCollapsed(false);
  else setDrawer(!$('sidebar').classList.contains('open'));
});
$('sidebar-close').addEventListener('click', () => (drawer() ? setDrawer(false) : setCollapsed(true)));
addEventListener('click', (e) => {
  if ($('sidebar').classList.contains('open') && !$('sidebar').contains(e.target) && !e.target.closest('#sidebar-toggle')) setDrawer(false);
});
// Chrome's side panel ignores window.close(); it has its own close call.
$('close-panel').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  chrome.sidePanel.close({windowId: win.id}).catch(() => window.close());
});

// ---- playing along with the video ----------------------------------------------

let sync = null; // {tabId, speed}
// What plays along: 'piano' (the video muted), 'both', or 'song' (the sheet silent). Remembered.
let sound = 'both';
chrome.storage.local.get('videoSound').then(({videoSound}) => { if (videoSound) sound = videoSound; showSound(); });

function syncNote(text) {
  $('sync-note').textContent = text || '';
  $('sync-bar').classList.toggle('hidden', !text && !sync);
}

const pianoVolume = () => (sync && sound === 'song' ? 0 : Number($('volume').value));

function showSound() {
  $('sound-choice').classList.toggle('hidden', !sync);
  for (const button of document.querySelectorAll('[data-sound]')) button.setAttribute('aria-checked', String(button.dataset.sound === sound));
}

for (const button of document.querySelectorAll('[data-sound]')) {
  button.addEventListener('click', () => {
    sound = button.dataset.sound;
    chrome.storage.local.set({videoSound: sound}).catch(() => {});
    showSound();
    player.setVolume(pianoVolume());
    videoControl({muted: sound === 'piano'});
  });
}

/** When each bar sounds in the recording, from SheetSage2's downbeats. */
function recordingTimes() {
  return drawn && timing?.downbeats.length ? measureTimes(drawn.arranged.measures, timing.downbeats, timing.duration) : null;
}

/** The YouTube tab showing this capture's video, opened at the capture's start if none is. */
async function videoTab() {
  const id = new URL(clip.url).searchParams.get('v');
  const tabs = await chrome.tabs.query({url: ['https://www.youtube.com/watch*', 'https://music.youtube.com/watch*']});
  let tab = tabs.find((t) => new URL(t.url).searchParams.get('v') === id);
  if (!tab) {
    const url = new URL(clip.url);
    url.searchParams.set('t', `${Math.floor(clip.start)}s`);
    tab = await chrome.tabs.create({url: url.href});
    await new Promise((resolve) => {
      const done = (tabId, change) => {
        if (tabId === tab.id && change.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(resolve, 20000);
    });
  }
  // Make sure the page script is there and the player is ready.
  for (let i = 0; i < 40; i++) {
    const info = await chrome.tabs.sendMessage(tab.id, {type: 'info'}).catch(async () => {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']}).catch(() => {});
      return null;
    });
    if (info?.ready && info.duration) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return tab;
}

async function videoControl(control) {
  if (!sync) return;
  const res = await chrome.tabs.sendMessage(sync.tabId, {type: 'sync-control', ...control}).catch(() => null);
  if (!res?.ok) stopSync();
}

async function startSync() {
  const times = recordingTimes();
  if (!times) return syncNote('This capture has no bar timing from SheetSage2, so it cannot follow the video. Transcribe it again to add it.');
  // In a full tab the video is elsewhere: show it with the score in the side panel instead.
  if (!inPanel) {
    const tab = await videoTab();
    await chrome.tabs.update(tab.id, {active: true});
    await chrome.sidePanel.setOptions({path: `clip.html?${new URLSearchParams({id: clip.id, panel: '1'})}`, enabled: true}).catch(() => {});
    chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
    return;
  }
  $('with-video').setAttribute('aria-busy', 'true');
  try {
    player.pause();
    const tab = await videoTab();
    const speed = sheet.speed;
    await player.load(perform(drawn.arranged, speed, times));
    sync = {tabId: tab.id, speed};
    $('with-video').setAttribute('aria-pressed', 'true');
    player.setVolume(pianoVolume());
    showSound();
    syncNote('Playing with the video. Pause, seek or skip in either place; press With video again to stop.');
    highlighter?.resume();
    const res = await chrome.tabs.sendMessage(tab.id, {type: 'sync-start', at: clip.start + player.position * speed, rate: speed, muted: sound === 'piano'});
    if (res?.error) throw new Error(res.error);
  } catch (err) {
    await stopSync();
    syncNote(`Could not play along with the video (${err.message}).`);
  } finally {
    $('with-video').removeAttribute('aria-busy');
  }
}

async function stopSync({pause = true} = {}) {
  const was = sync;
  sync = null;
  $('with-video').setAttribute('aria-pressed', 'false');
  syncNote('');
  showSound();
  player.pause();
  player.setVolume(pianoVolume());
  if (was) chrome.tabs.sendMessage(was.tabId, {type: 'sync-stop', pause}).catch(() => {});
  if (drawn) await player.load(perform(drawn.arranged, sheet.speed));
  updateTransport();
}

$('with-video').addEventListener('click', () => (sync ? stopSync() : startSync()));

// The video drives the sheet: follow its time, pauses, seeks and speed.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'video-time' || !sync || sender.tab?.id !== sync.tabId || !player.piece) return;
  if (msg.rate && Math.abs(msg.rate - sync.speed) > 0.01) {
    sync.speed = msg.rate;
    player.load(perform(drawn.arranged, msg.rate, recordingTimes()));
    return;
  }
  const at = (msg.time - clip.start) / sync.speed;
  if (at > player.duration + 0.3) { stopSync(); return; }
  if (msg.paused || at < 0) {
    if (player.playing) player.pause();
    player.seek(Math.max(0, at));
  } else if (!player.playing || Math.abs(player.position - at) > 0.15) {
    player.play(at);
  }
  updateTransport();
  const bar = at >= 0 ? barAt(player.piece.bars, at) : -1;
  highlighter?.show(bar);
  lightNote(bar, at);
});

// Leaving the page gives the video its sound back.
addEventListener('pagehide', () => { if (sync) chrome.tabs.sendMessage(sync.tabId, {type: 'sync-stop'}).catch(() => {}); });

// Score settings
for (const [id, field] of [['sheet-title', 'title'], ['sheet-artist', 'artist']]) {
  $(id).addEventListener('input', () => {
    if (!sheet) return;
    sheet[field] = $(id).value;
    $('track-title').textContent = sheet.title || 'Score';
    heading();
    saveSoon();
    drawSoon();
  });
}
for (const button of document.querySelectorAll('[data-notation]')) {
  button.addEventListener('click', () => {
    if (!sheet || sheet.notation === button.dataset.notation) return;
    sheet.notation = button.dataset.notation;
    chrome.storage.local.set({notation: sheet.notation}).catch(() => {});
    saveSoon();
    drawSheet();
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

// Transport
$('play').addEventListener('click', () => {
  if (sync) return videoControl({action: player.playing ? 'pause' : 'play'});
  return player.playing ? (player.pause(), updateTransport()) : playSheet();
});
$('restart').addEventListener('click', () => {
  if (sync) return videoControl({action: 'seek', at: clip.start});
  player.seek(0); highlighter?.resume(); highlighter?.show(player.playing ? 0 : -1); updateTransport();
});
$('seek').addEventListener('input', () => {
  if (sync) return videoControl({action: 'seek', at: clip.start + Number($('seek').value) * sync.speed});
  player.seek(Number($('seek').value));
  highlighter?.resume();
  highlighter?.show(litBar());
  updateTransport();
});
$('loop').addEventListener('click', () => {
  player.loop = !player.loop;
  $('loop').setAttribute('aria-pressed', String(player.loop));
});
$('speed').addEventListener('change', async () => {
  sheet.speed = Number($('speed').value);
  saveSoon();
  if (sync) return videoControl({rate: sheet.speed});
  if (drawn) await player.load(perform(drawn.arranged, sheet.speed));
  updateTransport();
});
$('volume').addEventListener('input', () => player.setVolume(pianoVolume()));

// Clicking a bar plays the sheet from it.
$('sheet').addEventListener('click', (e) => {
  const index = highlighter?.indexOf(e.target) ?? -1;
  if (index < 0 || !player.piece) return;
  highlighter.resume();
  if (sync) videoControl({action: 'seek', at: clip.start + player.piece.bars[index].start * sync.speed});
  else playSheet(player.piece.bars[index].start);
  highlighter.show(index);
});

// Toolbar
$('follow').addEventListener('change', () => {
  if (!highlighter) return;
  highlighter.follow = $('follow').checked;
  if (highlighter.follow) highlighter.resume();
});
for (const [id, step] of [['zoom-out', -0.1], ['zoom-in', 0.1]]) {
  $(id).addEventListener('click', () => {
    sheet.zoom = Math.round(Math.max(0.6, Math.min(1.6, sheet.zoom + step)) * 10) / 10;
    syncControls(drawn?.arranged ?? null);
    saveSoon();
  });
}
const print = () => {
  document.querySelector('.download-menu').open = false;
  if (inPanel && clip) chrome.tabs.create({url: `clip.html?${new URLSearchParams({id: clip.id, print: '1'})}`});
  else window.print();
};
$('open-tab').addEventListener('click', () => chrome.tabs.create({url: clip ? `clip.html?id=${clip.id}` : 'clip.html'}));
$('sheet-print').addEventListener('click', print);
// Download PDF: the pages at print resolution, straight to a file (no print dialog).
$('download-pdf').addEventListener('click', async () => {
  if (!drawn?.svgs) return;
  const button = $('download-pdf');
  const label = button.textContent;
  button.textContent = 'Making the PDF…';
  button.disabled = true;
  try {
    const {title, composer} = drawn.header;
    const blob = await scorePdf(drawn.svgs, {
      title, author: [composer, CREDIT].filter(Boolean).join(' · '),
      subject: AI_NOTE, keywords: 'sheet music, AI-generated, SheetSage2, m-a-p/SheetSage2',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName([title, composer].filter(Boolean).join(' - '))} (AI transcription, SheetSage2).pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    document.querySelector('.download-menu').open = false;
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
});
addEventListener('click', (e) => {
  const menu = document.querySelector('.download-menu');
  if (menu.open && !menu.contains(e.target)) menu.open = false;
});

// Printing (and Save as PDF) uses clean copies of the pages, named after the song.
let titleBeforePrint = '';
addEventListener('beforeprint', () => {
  if (!drawn) return;
  if (drawn.letters) {
    const copy = $('sheet').querySelector('.letters')?.cloneNode(true);
    copy?.querySelectorAll('.now, .on').forEach((n) => n.classList.remove('now', 'on'));
    $('print-root').replaceChildren(...(copy ? [copy] : []));
  } else $('print-root').replaceChildren(...drawn.svgs.map((svg, i) => {
    const page = document.createElement('div');
    page.className = 'print-page';
    page.innerHTML = svg;
    if (i) page.append(Object.assign(document.createElement('span'), {className: 'page-number', textContent: String(i + 1)}));
    return page;
  }));
  titleBeforePrint = document.title;
  // The PDF takes its name and title from the page: say it is an AI transcription there too.
  document.title = `${safeName([drawn.header.title, drawn.header.composer].filter(Boolean).join(' - '))} (AI transcription, SheetSage2)`;
});
addEventListener('afterprint', () => {
  $('print-root').replaceChildren();
  if (titleBeforePrint) document.title = titleBeforePrint;
});

init();
