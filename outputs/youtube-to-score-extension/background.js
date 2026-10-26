// Runs a capture: the popup hands over the tab's audio stream, the offscreen
// document records it, and the finished clip opens in its own page.
const OFFSCREEN_URL = 'offscreen.html';

// The toolbar button opens the side panel, which stays beside the video. The
// click is handled here rather than by Chrome, because Chrome only lets an
// extension capture a tab's sound after a click on its icon in that tab; a
// panel Chrome opens by itself does not count.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false}).catch(() => {});
chrome.action.onClicked.addListener((tab) => {
  // Opening the panel must happen inside the click, before anything is awaited.
  chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
  chrome.storage.session.set({invoked: {tabId: tab.id, at: Date.now()}});
});
// Before Hugging Face sign-in the panel had a Space name and a pasted token; signing in replaced both.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(['space', 'token']).catch(() => {}));

const IDLE = {status: 'idle'};

let state;
async function current() {
  state ??= (await chrome.storage.session.get('capture')).capture || IDLE;
  return state;
}
async function update(fields, replace = false) {
  await current();
  state = replace ? fields : {...state, ...fields};
  await chrome.storage.session.set({capture: state});
  return state;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Records the audio of the YouTube tab you chose.',
  });
}

const closeOffscreen = () => chrome.offscreen.closeDocument().catch(() => {});
const toOffscreen = (msg) => chrome.runtime.sendMessage({target: 'offscreen', ...msg});
const toTab = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

function badge(text) {
  chrome.action.setBadgeText({text});
  if (text) chrome.action.setBadgeBackgroundColor({color: '#fb5729'});
}

async function end(fields) {
  const s = await current();
  if (s.tabId && !s.free) toTab(s.tabId, {type: 'stop'});
  await closeOffscreen();
  badge('');
  return update(fields, true);
}

const handlers = {
  // `free` is any website: no player to cue, so it records from the first sound until Stop.
  async start({tabId, streamId, seconds, start, title, channel, url, options, free = false, icon = ''}) {
    if ((await current()).status === 'recording') throw new Error('A recording is already running.');
    await ensureOffscreen();
    const meta = {title, channel: channel || '', url, start, requested: seconds, options, ...(free && {free, icon})};
    const res = await toOffscreen({type: 'record', streamId, seconds, meta});
    if (res?.error) {
      await closeOffscreen();
      throw new Error(res.error);
    }
    await update({status: 'recording', tabId, title, start, seconds, options, free, captured: 0, peak: 0, live: false, ad: false}, true);
    badge('REC');
    if (!free) await toTab(tabId, {type: 'play'});
    return {ok: true};
  },

  async stop() {
    if ((await current()).status === 'recording') await toOffscreen({type: 'finish'});
    return {ok: true};
  },

  async cancel() {
    await toOffscreen({type: 'cancel'}).catch(() => {});
    await end(IDLE);
    return {ok: true};
  },

  async dismiss() {
    await update(IDLE, true);
    return {ok: true};
  },

  async tick({captured, peak, live}) {
    if ((await current()).status === 'recording') await update({captured, peak, ...(typeof live === 'boolean' && {live})});
  },

  async gate({live, ad}, sender) {
    const s = await current();
    if (s.status === 'recording' && sender.tab?.id === s.tabId) await update({live, ad});
  },

  async 'video-ended'(msg, sender) {
    const s = await current();
    if (s.status === 'recording' && sender.tab?.id === s.tabId) await toOffscreen({type: 'finish'});
  },

  async captured({id}) {
    const s = await current();
    await end({status: 'idle', lastClip: id, lastTab: s.tabId});
    // The side panel shows the score itself when it is open; otherwise a tab opens.
    const panels = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']}).catch(() => []);
    if (panels.length) return;
    const query = new URLSearchParams({id});
    query.set('auto', '1');
    const tab = s.tabId ? await chrome.tabs.get(s.tabId).catch(() => null) : null;
    await chrome.tabs.create({
      url: `clip.html?${query}`,
      ...(tab && {index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId}),
    });
  },

  async failed({error}) {
    await end({status: 'error', error});
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handler = handlers[msg.type];
  if (!handler || (msg.target && msg.target !== 'background')) return;
  handler(msg, sender).then(reply, (err) => reply({error: err.message}));
  return true;
});

// Closing the tab mid-recording keeps what was captured so far.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await current();
  if (s.status === 'recording' && s.tabId === tabId) toOffscreen({type: 'finish'}).catch(() => end(IDLE));
});
