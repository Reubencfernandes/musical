import {clock, parseClock} from './time.js';
import {DEFAULT_SPACE} from './sheetsage.js';
import {animateWave, drawTimeline} from './dots.js';
import {putClip} from './db.js';
import {signIn, signOut, getAccount} from './hf-auth.js';

const $ = (id) => document.getElementById(id);
const WATCH = /^https:\/\/(www|music)\.youtube\.com\/watch\?/;
const views = ['elsewhere', 'setup', 'recording', 'failed'];
// SheetSage2 reads 5 seconds to 10 minutes of audio.
const SHORTEST = 5;
const LONGEST = 600;

let tab = null;
let info = null;
let pick = null; // {start, end} in seconds
let poll = 0;
// The live level the recording wave animates to, and the animation's stop function.
let live = 0;
let stopWave = null;

let shown = '';
// The yt-dlp helper on this PC (native/), when it is installed: its yt-dlp version.
const HOST = 'com.kiku.youtube_to_score';
let helper = null;
let fetching = null;
let waitingForClick = 0;
function show(view) {
  shown = view;
  for (const v of views) $(v).classList.toggle('hidden', v !== view);
  if (view !== 'setup') clearInterval(poll);
  if (view === 'recording') stopWave ??= animateWave($('rec-wave'), () => live);
  else if (stopWave) { stopWave(); stopWave = null; }
}

/** Messages the YouTube tab, injecting the content script into tabs opened before install. */
async function ask(msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
    return chrome.tabs.sendMessage(tab.id, msg);
  }
}

function setupError(text) {
  $('setup-error').textContent = text || '';
  $('setup-error').classList.toggle('hidden', !text);
}

const draftKey = () => `draft:${info?.videoId || tab?.url}`;
const saveDraft = () => chrome.storage.session.set({[draftKey()]: pick}).catch(() => {});

/** The part to suggest: the chapter playing now, else from here to the end of the video. */
function suggestion() {
  const now = Math.floor(info.time || 0);
  const chapter = info.chapters?.find((c) => now >= c.start && now < (c.end ?? Infinity));
  if (chapter && chapter.end != null) return {start: chapter.start, end: Math.min(chapter.end, chapter.start + LONGEST)};
  if (info.duration == null) return {start: now, end: now + 60};
  const start = info.duration - now < SHORTEST ? 0 : now;
  return {start, end: Math.min(Math.floor(info.duration), start + LONGEST)};
}

function render() {
  const duration = info.duration;
  $('start').value = clock(pick.start);
  $('end').value = clock(pick.end);
  $('timeline-wrap').classList.toggle('hidden', duration == null);
  if (duration != null) {
    for (const id of ['range-start', 'range-end']) $(id).max = String(Math.floor(duration));
    $('range-start').value = String(pick.start);
    $('range-end').value = String(pick.end);
    drawTimeline($('timeline'), {duration, start: pick.start, end: pick.end, now: info.time, chapters: info.chapters});
  }
  const chapter = info.chapters?.findIndex((c) => c.start === pick.start && Math.round(c.end ?? -1) === Math.round(pick.end));
  if (info.chapters?.length) $('chapter').value = chapter >= 0 ? String(chapter) : (pick.start === 0 && duration != null && pick.end >= Math.floor(duration) ? 'all' : 'custom');

  const length = pick.end - pick.start;
  const problem = length < SHORTEST ? `Choose at least ${SHORTEST} seconds.`
    : length > LONGEST ? 'SheetSage2 reads up to 10 minutes. Choose a shorter part.' : '';
  $('length').classList.toggle('problem', !!problem);
  $('length').textContent = problem || `Length ${clock(length)}`;
  if (!problem) {
    const extra = document.createElement('span');
    extra.className = 'muted';
    extra.textContent = '· records in real time';
    $('length').append(' ', extra);
  }
  $('record').disabled = !!problem;
}

/**
 * Sets one end of the part, inside the video and at least 5 seconds long. A
 * start past the end (or an end before the start) carries the part along,
 * keeping its length, instead of being refused.
 */
function setPick(which, value) {
  const limit = info.duration == null ? Infinity : Math.floor(info.duration);
  const v = Math.max(0, Math.min(Math.round(value), limit));
  const length = Math.max(SHORTEST, pick.end - pick.start);
  let {start, end} = pick;
  if (which === 'start') {
    start = v;
    if (end - start < SHORTEST) end = Math.min(limit, start + length);
    if (end - start < SHORTEST) start = Math.max(0, end - SHORTEST);
  } else {
    end = v;
    if (end - start < SHORTEST) start = Math.max(0, end - length);
    if (end - start < SHORTEST) end = Math.min(limit, start + SHORTEST);
  }
  pick = {start, end};
  setupError('');
  saveDraft();
  render();
}

async function refreshInfo() {
  const fresh = await ask({type: 'info'}).catch(() => null);
  if (!fresh) return;
  info = fresh;
  $('video-title').textContent = info.title;
  if (pick && info.duration != null) drawTimeline($('timeline'), {duration: info.duration, start: pick.start, end: pick.end, now: info.time, chapters: info.chapters});
}

async function showSetup() {
  show('setup');
  await refreshInfo();
  if (!info?.ready) {
    show('elsewhere');
    return;
  }
  const saved = (await chrome.storage.session.get(draftKey()))[draftKey()];
  pick = saved && (info.duration == null || saved.end <= info.duration + 1) ? saved : suggestion();
  const select = $('chapter');
  select.replaceChildren();
  if (info.chapters?.length) {
    const option = (value, text) => Object.assign(document.createElement('option'), {value, textContent: text});
    select.append(option('custom', 'Custom'), option('all', `Whole video · ${clock(info.duration)}`),
      ...info.chapters.map((c, i) => option(String(i), `${c.title} · ${clock(c.start)}–${clock(c.end ?? info.duration)}`)));
  }
  $('chapter-field').classList.toggle('hidden', !info.chapters?.length);
  render();
  showMethods();
  poll = setInterval(refreshInfo, 500);
  probeHelper().then((version) => { helper = version; showMethods(); });
}

function renderRecording(s) {
  show('recording');
  $('rec-title').textContent = s.title;
  $('rec-status').textContent = s.ad ? 'Ad playing · paused' : s.live ? 'Recording' : 'Waiting for playback';
  $('rec-time').textContent = `${clock(s.captured)} / ${clock(s.seconds)}`;
  // Peaks arrive four times a second; the wave eases between them every frame.
  live = s.live ? Math.min(1, Math.sqrt(s.peak || 0) * 1.4) : 0;
}

async function renderState(capture) {
  if (fetching) return;
  if (capture?.status === 'recording') return renderRecording(capture);
  // A recording from this tab just finished: show its score here in the panel.
  if (capture?.status === 'idle' && capture.lastClip && capture.lastTab === tab?.id && shown === 'recording') {
    location.href = `clip.html?${new URLSearchParams({id: capture.lastClip, auto: '1', panel: '1'})}`;
    return;
  }
  if (capture?.status === 'error') {
    show('failed');
    $('failed-text').textContent = capture.error;
    return;
  }
  if ($('setup').classList.contains('hidden') || !info) {
    if (tab && WATCH.test(tab.url || '')) await showSetup();
    else show('elsewhere');
  }
}

async function record(event) {
  event.preventDefault();
  setupError('');
  await refreshInfo();
  if (!info) return setupError('Could not reach the video. Reload the YouTube tab and try again.');
  if (info.ad) return setupError('An ad is playing. Wait for it to finish, then record.');
  const seconds = pick.end - pick.start;
  if (seconds < SHORTEST || seconds > LONGEST) return;

  // Every recording goes straight to SheetSage2 for the full score: tune and chords.
  const options = {transcribe: true, melody: false, piano: false};
  $('record').disabled = true;
  try {
    const cued = await ask({type: 'prepare', start: pick.start});
    if (cued?.error) throw new Error(cued.error);
    const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
    const res = await chrome.runtime.sendMessage({
      target: 'background', type: 'start',
      tabId: tab.id, streamId, start: pick.start, seconds, title: info.title, channel: info.channel, url: info.url, options,
    });
    if (res?.error) throw new Error(res.error);
  } catch (err) {
    if (/not been invoked|activeTab/i.test(err.message)) {
      // Chrome needs a click on the icon in this tab first; record as soon as it comes.
      waitingForClick = Date.now();
      setupError('Chrome needs one click on the YouTube to Score icon in your toolbar, on this video’s tab, before it can record it. Click the icon and recording starts.');
    } else {
      setupError(/active stream/i.test(err.message)
        ? 'This tab is already being captured. Stop the other capture first.'
        : err.message);
    }
  } finally {
    $('record').disabled = false;
  }
}

/** Asks whether the yt-dlp helper is installed; resolves to its yt-dlp version, or null. */
function probeHelper() {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch { return resolve(null); }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try { port.disconnect(); } catch {}
      resolve(value);
    };
    port.onMessage.addListener((m) => done(m.type === 'ready' && m.ytdlp ? m.ytdlp : null));
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; done(null); });
    port.postMessage({type: 'probe'});
    setTimeout(() => done(null), 8000);
  });
}

function showMethods() {
  const can = !!helper && info?.duration != null;
  $('fetch').classList.toggle('hidden', !can);
  $('record').classList.toggle('primary', !can);
  $('record').textContent = can ? 'Record instead' : 'Record';
  $('method-note').textContent = can
    ? `Get audio now fetches just this part with yt-dlp (${helper}) on this PC, in seconds. Record captures it from the video in real time instead.`
    : 'The video plays while it records, so a part takes as long as it lasts. Ads and buffering are left out, and the sheet music opens when it finishes.';
}

/** Fetches the chosen part with yt-dlp on this PC, saves it as a capture and opens its score. */
async function fetchNow() {
  setupError('');
  await refreshInfo();
  if (!info?.videoId) return setupError('Could not read this video. Reload the YouTube tab and try again.');
  const seconds = pick.end - pick.start;
  if (seconds < SHORTEST || seconds > LONGEST) return;
  const part = {...pick};
  show('recording');
  $('rec-title').textContent = info.title;
  $('rec-status').textContent = 'Getting audio';
  $('rec-time').textContent = 'Starting yt-dlp…';
  live = 0.25;
  $('stop').classList.add('hidden');
  const port = chrome.runtime.connectNative(HOST);
  const chunks = [];
  fetching = port;
  try {
    await new Promise((resolve, reject) => {
      port.onMessage.addListener((m) => {
        if (m.type === 'progress') {
          $('rec-time').textContent = m.stage === 'download' ? `Downloading ${Math.round(m.percent)}%`
            : m.stage === 'cached' ? 'Already on this PC' : 'Cutting your part';
          live = m.stage === 'download' ? 0.2 + 0.6 * (m.percent / 100) : 0.6;
        } else if (m.type === 'chunk') {
          chunks[m.index] = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
        } else if (m.type === 'done') {
          resolve();
        } else if (m.type === 'error') {
          reject(new Error(m.error));
        }
      });
      port.onDisconnect.addListener(() => {
        const why = chrome.runtime.lastError?.message;
        reject(new Error(fetching ? `The yt-dlp helper stopped${why ? ` (${why})` : ''}.` : 'Cancelled.'));
      });
      port.postMessage({type: 'fetch', videoId: info.videoId, start: part.start, end: part.end});
    });
    const clip = {
      id: crypto.randomUUID(), title: info.title, channel: info.channel || '', url: info.url,
      start: part.start, requested: seconds, seconds, created: Date.now(), source: 'yt-dlp',
      options: {transcribe: true, melody: false, piano: false},
      audio: new Blob(chunks, {type: 'audio/mpeg'}),
    };
    await putClip(clip);
    location.href = `clip.html?${new URLSearchParams({id: clip.id, auto: '1', panel: '1'})}`;
  } catch (err) {
    show('setup');
    if (err.message !== 'Cancelled.') setupError(err.message);
  } finally {
    fetching = null;
    try { port.disconnect(); } catch {}
    $('stop').classList.remove('hidden');
  }
}

async function init() {
  [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const saved = await chrome.storage.local.get(['space', 'token']);
  $('space').value = saved.space || DEFAULT_SPACE;
  $('token').value = saved.token || '';
  renderAccount();

  const {capture} = await chrome.storage.session.get('capture');
  await renderState(capture);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.capture) renderState(changes.capture.newValue);
    if (area === 'local' && changes.account) renderAccount();
    // The icon was clicked in this tab after Record asked for it: record now.
    const invoked = area === 'session' && changes.invoked?.newValue;
    if (invoked && invoked.tabId === tab?.id && waitingForClick && Date.now() - waitingForClick < 120000 && shown === 'setup') {
      waitingForClick = 0;
      setupError('');
      $('setup').requestSubmit();
    }
  });
}

$('setup').addEventListener('submit', record);
$('range-start').addEventListener('input', () => setPick('start', Number($('range-start').value)));
$('range-end').addEventListener('input', () => setPick('end', Number($('range-end').value)));
for (const which of ['start', 'end']) {
  // Clicking a time selects it, so typing replaces it rather than adding to it.
  $(which).addEventListener('focus', () => $(which).select());
  $(which).addEventListener('mouseup', (e) => e.preventDefault());
  $(which).addEventListener('change', () => {
    const value = parseClock($(which).value);
    if (Number.isFinite(value)) setPick(which, value);
    else { setupError('Write times as minutes:seconds, like 1:23.'); render(); }
  });
  $(`${which}-now`).addEventListener('click', async () => {
    await refreshInfo();
    setPick(which, Math.floor(info.time));
  });
}
$('chapter').addEventListener('change', () => {
  const value = $('chapter').value;
  if (value === 'custom') return;
  const chosen = value === 'all' ? {start: 0, end: Math.floor(info.duration)} : info.chapters[Number(value)];
  pick = {start: chosen.start, end: Math.min(Math.floor(chosen.end ?? info.duration), chosen.start + LONGEST)};
  saveDraft();
  render();
});
$('stop').addEventListener('click', () => chrome.runtime.sendMessage({target: 'background', type: 'stop'}));
$('cancel').addEventListener('click', () => {
  if (fetching) {
    const port = fetching;
    fetching = null;
    port.disconnect();
    show('setup');
    return;
  }
  chrome.runtime.sendMessage({target: 'background', type: 'cancel'});
});
$('fetch').addEventListener('click', fetchNow);
$('dismiss').addEventListener('click', () => chrome.runtime.sendMessage({target: 'background', type: 'dismiss'}));
$('open-captures').addEventListener('click', () => { location.href = 'clip.html?panel=1'; });
// Chrome's side panel ignores window.close(); it has its own close call.
$('close-panel').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  chrome.sidePanel.close({windowId: win.id}).catch(() => window.close());
});

// The panel stays open across tabs and videos: start over when the video in view changes.
const restart = () => { if (shown !== 'recording') location.reload(); };
chrome.tabs.onActivated.addListener(({windowId}) => { if (windowId === tab?.windowId) restart(); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (tabId === tab?.id && change.url) restart(); });
/** Shows who is signed in to Hugging Face, renewing an expired sign-in quietly when it can. */
async function renderAccount() {
  let account = await getAccount();
  if (account?.expired) account = await signIn({interactive: false}).catch(() => null);
  $('signed-out').classList.toggle('hidden', !!account);
  $('signed-in').classList.toggle('hidden', !account);
  if (!account) return;
  $('account-handle').textContent = `@${account.handle}`;
  $('account-picture').classList.toggle('hidden', !account.picture);
  if (account.picture) $('account-picture').src = account.picture;
}

$('sign-in').addEventListener('click', async () => {
  $('account-error').classList.add('hidden');
  $('sign-in').disabled = true;
  try {
    await signIn();
  } catch (err) {
    if (err.message !== 'Sign-in was cancelled.') {
      $('account-error').textContent = err.message;
      $('account-error').classList.remove('hidden');
    }
  } finally {
    $('sign-in').disabled = false;
    renderAccount();
  }
});
$('sign-out').addEventListener('click', async () => { await signOut(); renderAccount(); });

$('save-settings').addEventListener('click', async () => {
  await chrome.storage.local.set({space: $('space').value.trim() || DEFAULT_SPACE, token: $('token').value.trim()});
  $('saved').classList.remove('hidden');
  setTimeout(() => $('saved').classList.add('hidden'), 1500);
});

init();
