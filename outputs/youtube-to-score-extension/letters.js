// Letter notes: the tune as note names (C D E♭ …) bar by bar, for readers who
// play from letters rather than staff notation. Each note's width follows its
// length and a line under it shows how long it is held; chord names sit above,
// and dots above or below a letter move it up or down an octave.

import {chordLabel} from './score.js';

const ACCIDENTAL = {1: '♯', 2: '♯♯', '-1': '♭', '-2': '♭♭'};
const TEXT_ACCIDENTAL = {1: '#', 2: '##', '-1': 'b', '-2': 'bb'};

/**
 * The melody of each measure as notes and gaps covering the bar, with the
 * chord names that start inside each. A note tied on from the bar before is
 * `held`: it shows as a line only, since its letter was already played.
 */
export function letterBars(arranged) {
  const bars = arranged.measures.map((m, index) => {
    const notes = [];
    for (const item of m.staves[0]) {
      const last = notes[notes.length - 1];
      if (item.rest || !item.pitches.length) {
        if (last?.rest) last.units += item.units;
        else notes.push({at: item.at, units: item.units, rest: true});
        continue;
      }
      // Pieces of one note that the engraver split at beats join up again here.
      if (item.tieStop && last && !last.rest) { last.units += item.units; continue; }
      const {letter, alter, octave} = item.pitches[0];
      notes.push({at: item.at, units: item.units, letter, alter, octave, held: !!item.tieStop});
    }
    for (const h of m.harmonies) {
      const target = notes.find((n) => h.at >= n.at && h.at < n.at + n.units) || notes[notes.length - 1];
      if (target) (target.chords ??= []).push(chordLabel(h.chord));
    }
    return {index, number: m.number, sections: m.sections, length: m.length, meter: m.meter, notes};
  });
  // The octave the tune mostly sits in is written plain; others get dots.
  const counts = new Map();
  for (const bar of bars) for (const n of bar.notes) if (n.letter && !n.held) counts.set(n.octave, (counts.get(n.octave) || 0) + n.units);
  const home = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
  return {bars, home};
}

const meterText = (meter) => (Array.isArray(meter) ? meter.join('/') : meter ? String(meter) : '');

function keyText(name) {
  const minor = name.endsWith('m');
  const tonic = (minor ? name.slice(0, -1) : name).replace('#', '♯').replace('b', '♭');
  return `${tonic} ${minor ? 'minor' : 'major'}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The letter page: a heading, a key to the marks, then the bars in rows. */
export function renderLetters(arranged, {title, composer, credit, note}) {
  const {bars, home} = letterBars(arranged);
  const page = el('div', 'letters');
  const head = el('header', 'letters-head');
  head.append(el('h2', 'letters-title', title));
  if (composer) head.append(el('p', 'letters-artist', composer));
  const facts = [`Key of ${keyText(arranged.key.name)}`, meterText(arranged.measures[0]?.meter), credit].filter(Boolean);
  head.append(el('p', 'letters-meta', facts.join(' · ')));
  const legend = el('p', 'letters-legend');
  legend.append(mark(1), ' octave higher', el('span', 'sep', '·'), mark(-1), ' octave lower', el('span', 'sep', '·'),
    el('span', 'legend-line'), ' how long to hold');
  head.append(legend);
  page.append(head);

  const grid = el('div', 'letter-grid');
  for (const bar of bars) {
    if (bar.sections.length) grid.append(el('div', 'letter-section', bar.sections.join(' · ')));
    // A busy bar takes two columns, so its letters keep their room.
    const cell = el('div', bar.notes.filter((n) => !n.rest).length > 8 ? 'letter-bar wide' : 'letter-bar');
    cell.dataset.index = String(bar.index);
    cell.append(el('span', 'bar-number', String(bar.number)));
    const row = el('div', 'bar-notes');
    for (const n of bar.notes) {
      const item = el('span', n.rest ? 'ln rest' : n.held ? 'ln held' : 'ln');
      item.style.flexGrow = String(n.units);
      item.dataset.at = String(n.at);
      item.dataset.units = String(n.units);
      item.append(el('span', 'ln-chord', n.chords?.join(' ') ?? ''));
      if (!n.rest && !n.held) {
        const name = el('span', 'ln-name');
        const shift = n.octave - home;
        if (shift > 0) name.append(dots(shift, 'up'));
        name.append(n.letter);
        if (n.alter) name.append(el('sup', 'ln-acc', ACCIDENTAL[n.alter] || ''));
        if (shift < 0) name.append(dots(-shift, 'down'));
        item.append(name);
      } else {
        item.append(el('span', 'ln-name', ' '));
      }
      if (!n.rest) item.append(el('span', 'ln-hold'));
      row.append(item);
    }
    cell.append(row);
    grid.append(cell);
  }
  page.append(grid);
  page.append(el('p', 'letters-foot', note));
  return page;
}

function dots(count, way) {
  return el('span', `ln-dots ${way}`, '•'.repeat(Math.min(count, 3)));
}

function mark(way) {
  const sample = el('span', 'legend-sample');
  if (way > 0) sample.append(dots(1, 'up'), 'C');
  else sample.append('C', dots(1, 'down'));
  return sample;
}

/**
 * The same letters as plain text, four bars to a line, for pasting or
 * printing anywhere. ' raises a note an octave and , lowers it; - holds it.
 */
export function lettersText(arranged, {title, composer, credit, note}) {
  const {bars, home} = letterBars(arranged);
  const lines = [title, composer, `Key of ${keyText(arranged.key.name)} · ${meterText(arranged.measures[0]?.meter)} · ${credit}`,
    "' = an octave higher   , = an octave lower   - = keep holding   (Am) = chord", ''].filter((l, i) => l || i === 4);
  let row = [];
  const flush = () => { if (row.length) lines.push(`| ${row.join(' | ')} |`); row = []; };
  for (const bar of bars) {
    if (bar.sections.length) {
      flush();
      if (lines[lines.length - 1]) lines.push('');
      lines.push(`[${bar.sections.join(' · ')}]`);
    }
    // A beat's worth of grid units: holds are counted out in beats.
    const beat = Math.max(1, Math.round(bar.length / (bar.meter?.[0] || 4)));
    const words = [];
    for (const n of bar.notes) {
      const chord = n.chords?.length ? `(${n.chords.join(' ')}) ` : '';
      const holds = Math.max(0, Math.round(n.units / beat) - 1);
      if (n.rest) { if (chord) words.push(chord.trim()); continue; }
      const shift = n.letter ? n.octave - home : 0;
      const name = n.held ? '-' : n.letter + (TEXT_ACCIDENTAL[n.alter] || '') + (shift > 0 ? "'".repeat(shift) : ','.repeat(-shift));
      words.push(chord + name + ' -'.repeat(holds));
    }
    row.push(words.join(' ') || '–');
    if (row.length === 4) flush();
  }
  flush();
  lines.push('', note);
  return lines.join('\n');
}
