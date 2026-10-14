// Builds a PDF of the engraved pages for download: each A4 page drawn at
// 300 dpi in shades of grey and stored losslessly (deflate), with the song,
// artist and the AI note in the document's properties.

const DPI = 300;
const WIDTH = Math.round(8.2677 * DPI);   // A4: 210 mm
const HEIGHT = Math.round(11.6929 * DPI); // A4: 297 mm
const POINTS = [595.28, 841.89];          // A4 in PDF points

/** One engraved page as a white-backed canvas at 300 dpi. */
async function drawPage(svg, pageNumber) {
  // Verovio's SVG only carries a viewBox; give it a size so it draws at print resolution.
  const sized = svg.replace(/<svg\b/, `<svg width="${WIDTH}" height="${HEIGHT}"`);
  const url = URL.createObjectURL(new Blob([sized], {type: 'image/svg+xml'}));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    if (pageNumber > 1) {
      // The same place as the page numbers on screen: bottom right.
      ctx.fillStyle = '#222';
      ctx.font = `${Math.round(DPI * 0.15)}px "Times New Roman", Times, serif`;
      ctx.textAlign = 'right';
      ctx.fillText(String(pageNumber), WIDTH * (1 - 0.067), HEIGHT * (1 - 0.036));
    }
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Grey levels of a canvas, compressed for a PDF image. */
async function greyImage(canvas) {
  const rgba = canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
  const grey = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) grey[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  return deflate(grey);
}

/** A PDF text string that keeps any characters: UTF-16BE in hex. */
function text(value) {
  let hex = 'FEFF';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += code.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

/**
 * The PDF for these SVG pages. `info` holds the title, author, subject and
 * keywords shown in the document's properties.
 */
export async function scorePdf(svgs, info = {}) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const write = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (number, body, stream) => {
    offsets[number] = length;
    write(`${number} 0 obj\n${body}\n`);
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  };

  // 1 catalog, 2 page tree, 3 info, then three objects per page.
  const pageCount = svgs.length;
  const kids = Array.from({length: pageCount}, (_, i) => `${4 + i * 3} 0 R`).join(' ');
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  const now = new Date();
  const date = `D:${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  object(3, `<< /Title ${text(info.title || 'Score')} /Author ${text(info.author || '')} /Subject ${text(info.subject || '')}`
    + ` /Keywords ${text(info.keywords || '')} /Creator ${text('YouTube to Score')} /Producer ${text('YouTube to Score, Verovio')}`
    + ` /CreationDate (${date}) >>`);
  for (let i = 0; i < pageCount; i++) {
    const image = await greyImage(await drawPage(svgs[i], i + 1));
    const page = 4 + i * 3;
    const draw = encoder.encode(`q ${POINTS[0]} 0 0 ${POINTS[1]} 0 0 cm /Page Do Q`);
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${POINTS[0]} ${POINTS[1]}] /Resources << /XObject << /Page ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    object(page + 1, `<< /Length ${draw.length} >>`, draw);
    object(page + 2, `<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} /ColorSpace /DeviceGray /BitsPerComponent 8`
      + ` /Filter /FlateDecode /Length ${image.length} >>`, image);
  }
  const total = 4 + pageCount * 3;
  const xref = length;
  write(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) write(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type: 'application/pdf'});
}
