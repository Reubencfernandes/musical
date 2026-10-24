// Captures live in the extension's IndexedDB, shared by the recorder and the clip page.
const DB = 'youtube-to-score';
const STORE = 'clips';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const putClip = (clip) => run('readwrite', (store) => store.put(clip));
export const getClip = (id) => run('readonly', (store) => store.get(id));
export const deleteClip = (id) => run('readwrite', (store) => store.delete(id));

/** Every capture, newest first, without loading its audio. */
export async function listClips() {
  const clips = await run('readonly', (store) => store.getAll());
  return clips
    .map(({id, title, channel, url, start, seconds, created, result, sheet}) => ({
      id, title, channel, url, start, seconds, created, scored: !!result,
      sheet: sheet && {title: sheet.title, artist: sheet.artist},
    }))
    .sort((a, b) => b.created - a.created);
}
