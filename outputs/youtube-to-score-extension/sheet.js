// Engraves arranged MusicXML into A4 pages with Verovio, and follows a
// recording along the score one measure at a time.

const OPTIONS = {
  // A4 in tenths of a millimetre; scale 118 gives an 8.5 mm staff, a size that reads well on screen and in print.
  pageWidth: 2100, pageHeight: 2970, scale: 118,
  pageMarginTop: 120, pageMarginBottom: 150, pageMarginLeft: 140, pageMarginRight: 140,
  header: 'encoded', footer: 'encoded',
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

// Verovio's page is 21 000 units wide; 18 200 lie between the margins. Its
// header text sizes, measured from its SVG: normal 405, small 324, large 486,
// x-large 607, xx-large 810 units, set in Times.
const LINE = 18200 * 0.94;
const SIZES = {'xx-large': 810, 'x-large': 607, large: 486, normal: 405, small: 324};

let ruler = null;
/** How wide a line of header text is, in page units. */
function width(text, size) {
  if (typeof document === 'undefined') return text.length * SIZES[size] * 0.5;
  ruler ??= document.createElement('canvas').getContext('2d');
  ruler.font = `${SIZES[size]}px "Times New Roman", Times, serif`;
  return ruler.measureText(text).width;
}

/** The text split at the space that best balances two lines. */
function balance(text) {
  const words = text.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const longest = Math.max(...lines.map((l) => l.length));
    if (!best || longest < best.longest) best = {lines, longest};
  }
  return best ? best.lines : [text];
}

/** Text cut short with an ellipsis so it fits one line at this size. */
function shorten(text, size, room) {
  let cut = text;
  while (cut.length > 1 && width(`${cut}…`, size) > room) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * A title that fits across the page: as large as it can be on one line, then
 * smaller, then split over two balanced lines, and only then shortened.
 */
export function fitTitle(title, sizes = ['xx-large', 'x-large', 'large'], room = LINE) {
  for (const size of sizes) if (width(title, size) <= room) return {size, lines: [title]};
  for (const size of sizes.slice(1)) {
    const lines = balance(title);
    if (lines.length === 2 && lines.every((l) => width(l, size) <= room)) return {size, lines};
  }
  const size = sizes[sizes.length - 1];
  const [first, second = ''] = balance(title);
  return {size, lines: [width(first, size) <= room ? first : shorten(first, size, room), second && (width(second, size) <= room ? second : shorten(second, size, room))].filter(Boolean)};
}

// Every page says, in print and in its data, that an AI wrote the notes.
export const AI_NOTE = 'AI-generated transcription by SheetSage2 (m-a-p) · may contain errors';
const AI_META = 'AI-generated sheet music. Notes and chords transcribed from a recording by SheetSage2 '
  + '(m-a-p/SheetSage2, https://huggingface.co/m-a-p/SheetSage2); piano arrangement and engraving by YouTube to Score.';
const footer = (func) => `<pgFoot func="${func}"><rend halign="left" valign="bottom"><rend fontsize="x-small" fontstyle="italic">${esc(AI_NOTE)}</rend></rend></pgFoot>`;

/** The first page's title block, and a running title on the pages after it. */
function titleBlock({title, composer, credit}) {
  const head = fitTitle(title);
  // The artist sits under the title on the right, so it may take most of a line.
  const artist = composer ? fitTitle(composer, ['normal', 'small'], LINE * 0.7) : null;
  const right = [
    artist && `<rend fontsize="${artist.size}">${artist.lines.map(esc).join('<lb/>')}</rend>`,
    credit && `<rend fontsize="small" fontstyle="italic">${esc(credit)}</rend>`,
  ].filter(Boolean).join('<lb/>');
  // Verovio sets the right-hand lines level with the title's last line. When
  // they would reach in under the title, they go centred beneath it instead.
  const titleWidth = Math.max(...head.lines.map((l) => width(l, head.size)));
  const rightWidth = Math.max(artist ? Math.max(...artist.lines.map((l) => width(l, artist.size))) : 0, credit ? width(credit, 'small') : 0);
  const stacked = right && rightWidth > (LINE - titleWidth) / 2;
  const running = width(title, 'small') <= LINE * 0.7 ? title : shorten(title, 'small', LINE * 0.7);
  return `<pgHead func="first"><rend halign="center" valign="top"><rend fontsize="${head.size}">${head.lines.map(esc).join('<lb/>')}</rend>`
    + (stacked ? `<lb/>${right}` : '') + '</rend>'
    + (right && !stacked ? `<rend halign="right" valign="bottom">${right}</rend>` : '')
    + `</pgHead><pgHead func="all"><rend halign="left" valign="top"><rend fontsize="small" fontstyle="italic">${esc(running)}</rend></rend></pgHead>`
    + footer('first') + footer('all');
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
  // The provenance also rides inside each page's SVG, for anyone (or anything) reading the file.
  const label = `<title>${esc(header.title)} · AI transcription</title><desc>${esc(AI_META)}</desc>`
    + `<metadata><ai-provenance xmlns="urn:youtube-to-score" generator="SheetSage2" model="m-a-p/SheetSage2" ai-generated="true"/></metadata>`;
  return Array.from({length: tk.getPageCount()}, (_, i) => tk.renderToSVG(i + 1)
    .replace(/<svg\b([^>]*)>/, `<svg$1 data-ai-generated="SheetSage2">${label}`));
}

/**
 * When each measure sounds in the recording: SheetSage2's downbeats mark bar
 * lines, and the first bar (or its pickup) starts with the recording.
 */
export function measureTimes(measures, downbeats, duration) {
  const bounds = [0, ...downbeats.filter((t) => t > 0.05).sort((a, b) => a - b)];
  return measures.map((m) => ({start: bounds[m.index], end: bounds[m.index + 1] ?? duration}));
}

/** The bar sounding at `time`, given each bar's {start, end}. */
export const barAt = (bars, time) => bars.findIndex((b) => time >= b.start && time < b.end);

/**
 * Lights up one bar at a time and keeps it in view while the reader follows
 * along. Scrolling by hand (wheel, touch, keys or the scrollbar) leaves the
 * page where the reader put it; following resumes once the lit bar is back in
 * view, or when `resume` is called (play, seek, a click on a bar).
 */
export class Highlighter {
  constructor(container, {topInset = 96} = {}) {
    this.measures = [...container.querySelectorAll('svg g.measure')];
    this.topInset = topInset;
    this.current = -1;
    this.mark = null;
    this.follow = true;
    this.away = false;
    this.leave = () => { this.away = true; };
    this.onKey = (e) => {
      if (/^(PageUp|PageDown|ArrowUp|ArrowDown|Home|End| )$/.test(e.key) && !e.target.closest?.('input, select, textarea, button')) this.away = true;
    };
    // A press on the page's own scrollbar lands on the root element.
    this.onPointer = (e) => { if (e.target === document.documentElement) this.away = true; };
    addEventListener('wheel', this.leave, {passive: true});
    addEventListener('touchmove', this.leave, {passive: true});
    addEventListener('keydown', this.onKey);
    addEventListener('pointerdown', this.onPointer);
  }

  /** The bar index under a click, or -1. */
  indexOf(target) {
    return this.measures.indexOf(target.closest?.('g.measure'));
  }

  show(index) {
    const changed = index !== this.current;
    if (changed) {
      this.current = index;
      this.mark?.remove();
      this.mark = null;
      if (index >= 0 && this.measures[index]) {
        const g = this.measures[index];
        const box = g.getBBox();
        const pad = 60;
        this.mark = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        Object.entries({x: box.x - pad / 2, y: box.y - pad, width: box.width + pad, height: box.height + 2 * pad, rx: 40, class: 'now'})
          .forEach(([k, v]) => this.mark.setAttribute(k, v));
        g.insertBefore(this.mark, g.firstChild);
      }
    }
    if (!this.mark || !this.follow) return;
    const rect = this.mark.getBoundingClientRect();
    const visible = rect.top >= this.topInset && rect.bottom <= innerHeight - 16;
    if (this.away) {
      if (visible) this.away = false;
      return;
    }
    if (changed && !visible) {
      this.mark.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
  }

  resume() { this.away = false; }

  clear() { this.show(-1); }

  destroy() {
    this.clear();
    removeEventListener('wheel', this.leave);
    removeEventListener('touchmove', this.leave);
    removeEventListener('keydown', this.onKey);
    removeEventListener('pointerdown', this.onPointer);
  }
}
