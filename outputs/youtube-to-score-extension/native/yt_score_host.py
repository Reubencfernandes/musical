"""Native messaging helper for YouTube to Score: fetches a song's audio with yt-dlp on this PC.

Chrome starts this script when the extension asks for it and talks to it over
stdin/stdout: each message is a 4-byte little-endian length, then UTF-8 JSON.

Requests:
  {"type": "probe"}                               -> {"type": "ready", "ytdlp": version}
  {"type": "fetch", "url", "start", "end"}        -> progress messages, the MP3 in chunks, then "done"

The audio is downloaded once per video into a cache folder, then the exact
range is cut with ffmpeg, so the clip starts where the score expects it to.
"""
import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / 'youtube-to-score-audio'
CHUNK = 600_000  # bytes of MP3 per message; Chrome caps messages from a host at 1 MB
KEEP_SECONDS = 7 * 24 * 3600
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def read():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack('<I', header)
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))


def send(message):
    data = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
    sys.stdout.buffer.flush()


def ytdlp():
    """The yt-dlp command: the installed program, else the Python module."""
    exe = shutil.which('yt-dlp')
    return [exe] if exe else [sys.executable, '-m', 'yt_dlp']


def version():
    try:
        out = subprocess.run(ytdlp() + ['--version'], capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
        return out.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def tidy():
    """Forget cached songs not used for a week."""
    if not CACHE.exists():
        return
    for item in CACHE.iterdir():
        try:
            # Cut clips are temporary: any left by an interrupted fetch go at once.
            if item.name.startswith('clip-') or time.time() - item.stat().st_mtime > KEEP_SECONDS:
                item.unlink()
        except OSError:
            pass


def download(video_id):
    """The video's best audio stream, from the cache when it is there."""
    CACHE.mkdir(parents=True, exist_ok=True)
    for cached in CACHE.glob(f'{video_id}.*'):
        if cached.suffix not in ('.part', '.ytdl', '.mp3') and cached.stat().st_size > 0:
            os.utime(cached)
            send({'type': 'progress', 'stage': 'cached', 'percent': 100})
            return cached
    command = ytdlp() + [
        '--no-playlist', '--no-warnings', '--newline', '-f', 'bestaudio/best',
        '--progress-template', 'download:%(progress._percent_str)s',
        '-o', str(CACHE / f'{video_id}.%(ext)s'),
        f'https://www.youtube.com/watch?v={video_id}',
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, creationflags=NO_WINDOW)
    tail = []
    for line in process.stdout:
        line = line.strip()
        tail = (tail + [line])[-6:]
        match = re.search(r'([\d.]+)%', line)
        if match:
            send({'type': 'progress', 'stage': 'download', 'percent': float(match.group(1))})
    if process.wait() != 0:
        detail = next((l for l in reversed(tail) if 'ERROR' in l), tail[-1] if tail else 'unknown error')
        raise RuntimeError(f'yt-dlp could not get the audio: {detail}')
    files = [f for f in CACHE.glob(f'{video_id}.*') if f.suffix not in ('.part', '.ytdl', '.mp3')]
    if not files:
        raise RuntimeError('yt-dlp finished without an audio file.')
    return files[0]


def cut(source, start, end):
    """The exact range as a 192 kbps stereo MP3, the same format the recorder makes."""
    handle, name = tempfile.mkstemp(prefix='clip-', suffix='.mp3', dir=CACHE)
    os.close(handle)  # Windows will not let ffmpeg write a file this process still has open
    out = Path(name)
    command = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source), '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}',
               '-vn', '-ac', '2', '-ar', '48000', '-b:a', '192k', str(out)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300, creationflags=NO_WINDOW)
    if result.returncode != 0 or not out.exists() or out.stat().st_size < 1024:
        out.unlink(missing_ok=True)
        raise RuntimeError(f'ffmpeg could not cut the audio: {result.stderr.strip()[-200:]}')
    return out


def fetch(request):
    video_id = str(request.get('videoId', ''))
    start, end = float(request['start']), float(request['end'])
    if not VIDEO_ID.match(video_id):
        raise ValueError('That is not a YouTube video id.')
    if not (0 <= start < end) or end - start > 600:
        raise ValueError('Choose a part between 5 seconds and 10 minutes long.')
    if not shutil.which('ffmpeg'):
        raise RuntimeError('ffmpeg is not installed on this PC.')
    source = download(video_id)
    send({'type': 'progress', 'stage': 'cut', 'percent': 100})
    clip = cut(source, start, end)
    try:
        data = clip.read_bytes()
    finally:
        clip.unlink(missing_ok=True)
    chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)]
    for index, chunk in enumerate(chunks):
        send({'type': 'chunk', 'index': index, 'count': len(chunks), 'data': base64.b64encode(chunk).decode('ascii')})
    send({'type': 'done', 'bytes': len(data), 'seconds': end - start})


def main():
    tidy()
    while True:
        request = read()
        if request is None:
            return
        try:
            if request.get('type') == 'probe':
                send({'type': 'ready', 'ytdlp': version()})
            elif request.get('type') == 'fetch':
                fetch(request)
            else:
                send({'type': 'error', 'error': 'Unknown request.'})
        except Exception as err:  # every failure goes back to the extension as a message
            send({'type': 'error', 'error': str(err)})


if __name__ == '__main__':
    main()
