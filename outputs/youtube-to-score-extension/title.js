// Turns a YouTube video title into a song title and artist for the score.

// Bracketed YouTube noise: "(Official Video)", "[Lyrics]", "(feat. Someone)", "(HD)"…
const NOISE = /\s*[([【][^)\]】]*?\b(official|lyrics?|audio|video|visuali[sz]er|m\/?v|hd|hq|4k|remaster(?:ed)?|explicit|clean|karaoke|letra|subs?|subtitles|full song|feat\.?|ft\.?)(?![\w])[^)\]】]*[)\]】]/gi;

const simplify = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The channel name as an artist: "Adele - Topic" and "AdeleVEVO" become "Adele". */
export function artistFromChannel(channel = '') {
  return channel.replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
}

/** "Artist - Song (Official Video)" → {title: "Song", artist: "Artist"}. */
export function songInfo(videoTitle = '', channel = '') {
  const text = videoTitle
    .replace(NOISE, '')
    .replace(/\s+(?:\||｜|•)\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const unquote = (s) => s.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  const artist = artistFromChannel(channel);
  // Featured artists come off each side of the dash separately.
  const parts = text.split(/\s+[-–—]\s+/).map((part) => part.replace(/\s+(?:ft|feat|featuring)\.?\s.*$/i, '').trim());
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const [first, ...rest] = parts;
    const second = rest.join(' – ');
    // "Song - Artist" is rarer; trust the channel when it names the second half.
    if (artist && simplify(second) === simplify(artist) && simplify(first) !== simplify(artist)) return {title: unquote(first), artist: second};
    return {title: unquote(second), artist: first};
  }
  return {title: unquote(parts[0] || text) || videoTitle.trim() || 'Untitled', artist};
}
