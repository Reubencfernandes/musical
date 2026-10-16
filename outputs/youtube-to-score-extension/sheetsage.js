// Calls a SheetSage2 Gradio Space's /transcribe endpoint (Score-Studio-API by default)
// and brings the returned files back as blobs, so they outlive the Space's 24 h cache.
export const DEFAULT_SPACE = 'Reubencf/Score-Studio-API';

/** Accepts "owner/name" or a full https://….hf.space URL. */
export function spaceUrl(space) {
  const id = (space || DEFAULT_SPACE).trim();
  if (/^https?:\/\//.test(id)) return id.replace(/\/+$/, '');
  const [owner, name] = id.split('/');
  if (!owner || !name) throw new Error('Set the Space as owner/name, for example Reubencf/Score-Studio-API.');
  return `https://${owner}-${name}`.toLowerCase().replace(/[_.]/g, '-') + '.hf.space';
}

async function failure(res, step) {
  if ([401, 403, 404].includes(res.status)) {
    return `The Space refused the ${step} (${res.status}). Check the Space name, and sign in with Hugging Face if it is private.`;
  }
  const text = (await res.text().catch(() => '')).slice(0, 200);
  return `The ${step} failed (${res.status}). ${text}`.trim();
}

/** Yields {event, data} from a Gradio server-sent event stream. */
async function* events(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      yield {event, data: data.join('\n')};
    }
  }
}

function parse(data) {
  try { return JSON.parse(data); } catch { return data; }
}

/**
 * Uploads the clip and runs /transcribe on all of it.
 * Returns the raw Gradio outputs: [status, pages, pdf, preview, downloads, abc, ...].
 */
async function call({space, token, blob, filename, seconds, melodyOnly, piano, onStatus, signal}) {
  const base = spaceUrl(space);
  const auth = token ? {Authorization: `Bearer ${token}`} : {};

  onStatus('Uploading audio');
  const form = new FormData();
  form.append('files', blob, filename);
  const upload = await fetch(`${base}/gradio_api/upload`, {method: 'POST', headers: auth, body: form, signal});
  if (!upload.ok) throw new Error(await failure(upload, 'upload'));
  const [path] = await upload.json();

  onStatus('Waiting for a GPU');
  const duration = Math.min(600, Math.max(5, Math.ceil(seconds)));
  const audio = {path, orig_name: filename, size: blob.size, mime_type: blob.type, meta: {_type: 'gradio.FileData'}};
  const queued = await fetch(`${base}/gradio_api/call/transcribe`, {
    method: 'POST',
    headers: {...auth, 'Content-Type': 'application/json'},
    body: JSON.stringify({data: [audio, 0, duration, !!melodyOnly, !!piano]}),
    signal,
  });
  if (!queued.ok) throw new Error(await failure(queued, 'request'));
  const {event_id: eventId} = await queued.json();

  const stream = await fetch(`${base}/gradio_api/call/transcribe/${eventId}`, {headers: auth, signal});
  if (!stream.ok) throw new Error(await failure(stream, 'result stream'));
  let last = null;
  for await (const {event, data} of events(stream)) {
    if (event === 'generating') {
      last = parse(data);
      if (typeof last?.[0] === 'string' && last[0]) onStatus(last[0].replace(/…$/, ''));
    } else if (event === 'complete') {
      return parse(data) || last;
    } else if (event === 'error') {
      const message = parse(data);
      // A detail-less error before any progress usually means ZeroGPU turned the request away.
      throw new Error(typeof message === 'string' && message
        ? message
        : last
          ? 'SheetSage2 could not transcribe this clip. Try a shorter excerpt.'
          : 'The Space turned the request away without saying why — usually the anonymous ZeroGPU quota is used up. '
            + 'Sign in with Hugging Face in the extension panel to use your own quota, or try again later.');
    }
  }
  if (last) return last;
  throw new Error('The Space closed the connection before finishing.');
}

// A download gives up only after this long with no data, so a slow file that is
// still arriving finishes, and a stalled one cannot hold "Downloading the score".
const IDLE_MS = 30000;

function source(file, base) {
  const data = file.image ?? file.video ?? file;
  const url = data.url || `${base}/gradio_api/file=${data.path}`;
  return {url, name: data.orig_name || decodeURIComponent(url.split('/').pop().split('?')[0])};
}

async function download({url, name}, auth, signal) {
  const label = name || 'a result file';
  const stalled = new AbortController();
  let timer;
  const wait = () => { clearTimeout(timer); timer = setTimeout(() => stalled.abort(), IDLE_MS); };
  const both = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
  wait();
  try {
    const res = await fetch(url, {headers: auth, signal: both});
    if (!res.ok) throw new Error(`Could not download ${label} (${res.status}).`);
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      chunks.push(value);
      wait();
    }
    return {name, blob: new Blob(chunks, {type: res.headers.get('content-type') || ''})};
  } catch (err) {
    if (stalled.signal.aborted && !signal?.aborted) throw new Error(`Downloading ${label} from the Space stalled.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Transcribes a clip and returns {status, abc, pages, pdf, preview, files} with every file as a blob. */
export async function transcribe(options) {
  const outputs = await call(options);
  const [status, pages, pdf, preview, files, abc] = outputs;
  const base = spaceUrl(options.space);
  const auth = options.token ? {Authorization: `Bearer ${options.token}`} : {};
  // The download list repeats the pages and PDF, so each name is fetched once.
  // The score is drawn from the ABC, so a file that will not download is left
  // out and named in the status instead of failing the whole transcription.
  const fetched = new Map();
  const missed = [];
  const get = (file) => {
    if (!file) return null;
    const src = source(file, base);
    if (!fetched.has(src.name)) {
      fetched.set(src.name, download(src, auth, options.signal).catch((err) => {
        if (options.signal?.aborted) throw err;
        missed.push(src.name || 'a result file');
        return null;
      }));
    }
    return fetched.get(src.name);
  };
  options.onStatus('Downloading the score');
  const result = {
    abc: abc || '',
    pages: await Promise.all((pages || []).map(get)),
    pdf: await get(pdf),
    preview: await get(preview),
    files: await Promise.all((files || []).map(get)),
  };
  const note = missed.length
    ? ` Could not download ${missed.join(', ')}; transcribe again to fetch ${missed.length > 1 ? 'them' : 'it'}.` : '';
  return {status: ((status || '') + note).trim(), ...result};
}
