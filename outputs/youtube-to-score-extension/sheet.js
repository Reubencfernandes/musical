// Engraves arranged MusicXML into A4 pages with Verovio, and follows a
// recording along the score one measure at a time.

const OPTIONS = {
  // A4 in tenths of a millimetre; scale 118 gives an 8.5 mm staff, a size that reads well on screen and in print.
  pageWidth: 2100, pageHeight: 2970, scale: 118,
  pageMarginTop: 120, pageMarginBottom: 150, pageMarginLeft: 140, pageMarginRight: 140,
  header: 'encoded', footer: 'none',
  breaks: 'auto', breaksNoWidow: true,
  svgViewBox: true, adjustPageHeight: false,
};

let toolkit = null;
function verovio() {
  toolkit ??= Promise.all([import('./vendor/verovio/verovio-module.mjs'), import('./vendor/verovio/verovio.mjs')])
    .then(async ([{default: create}, {VerovioToolkit}]) => new VerovioToolkit(await create()));
  return toolkit;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

/** The first page's title block, and a running title on the pages after it. */
function titleBlock({title, composer, credit}) {
  const right = [composer && esc(composer), credit && `<rend fontsize="small" fontstyle="italic">${esc(credit)}</rend>`].filter(Boolean).join('<lb/>');
  return `<pgHead func="first"><rend halign="center" valign="top"><rend fontsize="xx-large">${esc(title)}</rend></rend>`
    + (right ? `<rend halign="right" valign="bottom">${right}</rend>` : '')
    + `</pgHead><pgHead func="all"><rend halign="left" valign="top"><rend fontsize="small" fontstyle="italic">${esc(title)}</rend></rend></pgHead>`;
}

/**
 * SVG for each A4 page. Verovio reads the MusicXML, then the page header is
 * replaced in its MEI, since it lays out MusicXML credits in one plain row.
 */
export async function engrave(musicxml, header) {
  const tk = await verovio();
  tk.setOptions(OPTIONS);
  if (!tk.loadData(musicxml)) throw new Error('Verovio could not read the arranged score.');
  const mei = tk.getMEI({}).replace(/<pgHead\b[^>]*func="first"[^>]*>[\s\S]*?<\/pgHead>/, titleBlock(header));
  tk.setOptions(OPTIONS);
  if (!tk.loadData(mei)) throw new Error('Verovio could not lay out the score.');
  return Array.from({length: tk.getPageCount()}, (_, i) => tk.renderToSVG(i + 1));
}

/**
 * When each measure sounds in the recording: SheetSage2's downbeats mark bar
 * lines, and the first bar (or its pickup) starts with the recording.
 */
export function measureTimes(measures, downbeats, duration) {
  const bounds = [0, ...downbeats.filter((t) => t > 0.05).sort((a, b) => a - b)];
  return measures.map((m) => ({start: bounds[m.index], end: bounds[m.index + 1] ?? duration}));
}

/**
 * Highlights the measure each playing recording is in, scrolls it into view,
 * and seeks a recording to a measure when it is clicked. Returns a cleanup.
 */
export function follow(container, times, recordings, {onSeek} = {}) {
  const measures = [...container.querySelectorAll('svg g.measure')];
  if (!measures.length || measures.length !== times.length || times.some((t) => t.start == null)) return () => {};
  let current = -1;
  let mark = null;
  let frame = 0;

  const show = (index) => {
    if (index === current) return;
    current = index;
    mark?.remove();
    mark = null;
    if (index < 0) return;
    const g = measures[index];
    const box = g.getBBox();
    const pad = 60;
    mark = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({x: box.x - pad / 2, y: box.y - pad, width: box.width + pad, height: box.height + 2 * pad, rx: 40, class: 'now'})
      .forEach(([k, v]) => mark.setAttribute(k, v));
    g.insertBefore(mark, g.firstChild);
    const rect = mark.getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > innerHeight - 20) mark.scrollIntoView({block: 'center', behavior: 'smooth'});
  };

  const indexAt = (t) => times.findIndex((m) => t >= m.start && t < m.end);
  const tick = () => {
    const playing = recordings.find((a) => !a.paused);
    if (playing) show(indexAt(playing.currentTime));
    frame = playing ? requestAnimationFrame(tick) : 0;
  };
  const start = () => { if (!frame) frame = requestAnimationFrame(tick); };
  const seeked = (e) => show(indexAt(e.target.currentTime));
  for (const a of recordings) {
    a.addEventListener('play', start);
    a.addEventListener('seeked', seeked);
  }

  const click = (e) => {
    const g = e.target.closest?.('g.measure');
    const index = measures.indexOf(g);
    if (index < 0) return;
    const audio = recordings.find((a) => !a.paused) || recordings[0];
    audio.currentTime = times[index].start + 0.01;
    show(index);
    onSeek?.(audio);
  };
  container.addEventListener('click', click);
  if (recordings.some((a) => !a.paused)) start();

  return () => {
    cancelAnimationFrame(frame);
    mark?.remove();
    container.removeEventListener('click', click);
    for (const a of recordings) {
      a.removeEventListener('play', start);
      a.removeEventListener('seeked', seeked);
    }
  };
}
