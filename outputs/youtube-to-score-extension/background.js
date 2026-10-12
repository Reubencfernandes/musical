// Runs a capture: the popup hands over the tab's audio stream, the offscreen
// document records it, and the finished clip opens in its own page.
const OFFSCREEN_URL = 'offscreen.html';
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
  if (text) chrome.action.setBadgeBackgroundColor({color: '#c62828'});
}

async function end(fields) {
  const s = await current();
  if (s.tabId) toTab(s.tabId, {type: 'stop'});
  await closeOffscreen();
  badge('');
  return update(fields, true);
}

const handlers = {
  async start({tabId, streamId, seconds, start, title, url, options}) {
    if ((await current()).status === 'recording') throw new Error('A recording is already running.');
    await ensureOffscreen();
    const meta = {title, url, start, requested: seconds, options};
    const res = await toOffscreen({type: 'record', streamId, seconds, meta});
    if (res?.error) {
      await closeOffscreen();
      throw new Error(res.error);
    }
    await update({status: 'recording', tabId, title, start, seconds, options, captured: 0, peak: 0, live: false, ad: false}, true);
    badge('REC');
    await toTab(tabId, {type: 'play'});
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

  async tick({captured, peak}) {
    if ((await current()).status === 'recording') await update({captured, peak});
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
    await end({status: 'idle', lastClip: id});
    const query = new URLSearchParams({id});
    if (s.options?.transcribe) query.set('auto', '1');
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
