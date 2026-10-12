import {clock, parseClock} from './time.js';
import {DEFAULT_SPACE} from './sheetsage.js';

const $ = (id) => document.getElementById(id);
const WATCH = /^https:\/\/(www|music)\.youtube\.com\/watch\?/;
const views = ['elsewhere', 'setup', 'recording', 'failed'];

let tab = null;
let info = null;
let poll = 0;

function show(view) {
  for (const v of views) $(v).classList.toggle('hidden', v !== view);
  if (view !== 'setup') clearInterval(poll);
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

function pressPreset() {
  for (const b of document.querySelectorAll('.presets button')) {
    b.setAttribute('aria-pressed', String(b.dataset.len === $('length').value));
  }
}

async function refreshInfo() {
  info = await ask({type: 'info'}).catch(() => null);
  if (!info) return;
  $('video-title').textContent = info.title;
  $('position').textContent = clock(info.time);
}

async function showSetup() {
  show('setup');
  await refreshInfo();
  if (!info) {
    show('elsewhere');
    return;
  }
  $('start').value = clock(info.time);
  poll = setInterval(refreshInfo, 500);
}

function renderRecording(s) {
  show('recording');
  $('rec-title').textContent = s.title;
  const waiting = !s.live;
  $('rec-status').textContent = s.ad ? 'Ad playing — paused' : waiting ? 'Waiting for playback' : 'Recording';
  document.querySelector('.dot').classList.toggle('waiting', waiting);
  $('rec-time').textContent = `${clock(s.captured)} / ${clock(s.seconds)}`;
  $('rec-progress').style.width = `${Math.min(100, (100 * (s.captured || 0)) / s.seconds)}%`;
  $('rec-level').style.width = `${Math.min(100, Math.sqrt(s.peak || 0) * 100)}%`;
}

async function render(capture) {
  if (capture?.status === 'recording') return renderRecording(capture);
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
  const start = parseClock($('start').value);
  let seconds = Math.round(Number($('length').value));
  if (!info) return setupError('Could not reach the video. Reload the YouTube tab and try again.');
  if (info.ad) return setupError('An ad is playing. Wait for it to finish, then record.');
  if (!Number.isFinite(start)) return setupError('Write the start as minutes:seconds, like 1:23.');
  if (!(seconds >= 5 && seconds <= 600)) return setupError('Choose a length from 5 to 600 seconds.');
  if (info.duration != null) {
    if (start >= info.duration - 5) return setupError('Start at least 5 seconds before the video ends.');
    seconds = Math.min(seconds, Math.floor(info.duration - start));
  }

  const options = {transcribe: $('transcribe').checked, melody: $('melody').checked, piano: $('piano').checked};
  await chrome.storage.local.set({length: $('length').value, ...options});
  $('record').disabled = true;
  try {
    const cued = await ask({type: 'prepare', start});
    if (cued?.error) throw new Error(cued.error);
    const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
    const res = await chrome.runtime.sendMessage({
      target: 'background', type: 'start',
      tabId: tab.id, streamId, start, seconds, title: info.title, channel: info.channel, url: info.url, options,
    });
    if (res?.error) throw new Error(res.error);
  } catch (err) {
    setupError(/active stream/i.test(err.message)
      ? 'This tab is already being captured. Stop the other capture first.'
      : err.message);
  } finally {
    $('record').disabled = false;
  }
}

async function init() {
  [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const saved = await chrome.storage.local.get(['length', 'transcribe', 'melody', 'piano', 'space', 'token']);
  if (saved.length) $('length').value = saved.length;
  for (const key of ['transcribe', 'melody', 'piano']) if (key in saved) $(key).checked = saved[key];
  $('space').value = saved.space || DEFAULT_SPACE;
  $('token').value = saved.token || '';
  pressPreset();

  const {capture} = await chrome.storage.session.get('capture');
  await render(capture);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.capture) render(changes.capture.newValue);
  });
}

$('setup').addEventListener('submit', record);
$('use-position').addEventListener('click', () => { if (info) $('start').value = clock(info.time); });
$('length').addEventListener('input', pressPreset);
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => { $('length').value = b.dataset.len; pressPreset(); });
}
$('stop').addEventListener('click', () => chrome.runtime.sendMessage({target: 'background', type: 'stop'}));
$('cancel').addEventListener('click', () => chrome.runtime.sendMessage({target: 'background', type: 'cancel'}));
$('dismiss').addEventListener('click', () => chrome.runtime.sendMessage({target: 'background', type: 'dismiss'}));
$('open-captures').addEventListener('click', () => chrome.tabs.create({url: 'clip.html'}));
$('save-settings').addEventListener('click', async () => {
  await chrome.storage.local.set({space: $('space').value.trim() || DEFAULT_SPACE, token: $('token').value.trim()});
  $('saved').classList.remove('hidden');
  setTimeout(() => $('saved').classList.add('hidden'), 1500);
});

init();
