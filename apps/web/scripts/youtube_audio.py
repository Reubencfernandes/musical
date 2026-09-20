"""Import a complete public YouTube recording. No authentication bypass."""
import json
from pathlib import Path
import sys
from yt_dlp import YoutubeDL

video_id, target = sys.argv[1:]
class Quiet:
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass

options = {
    'logger': Quiet(), 'quiet': True, 'no_warnings': True,
    'noplaylist': True, 'socket_timeout': 15, 'retries': 1,
    'extractor_retries': 1, 'fragment_retries': 1,
    'js_runtimes': {'node': {}}, 'format': 'bestaudio/best',
    'extractor_args': {
        'youtube': {'player_client': ['android_vr', 'visionos', 'web_embedded', 'mweb']},
        'youtubepot-bgutilhttp': {'base_url': ['http://127.0.0.1:4416']},
    },
    'outtmpl': str(Path(target) / 'audio.%(ext)s'),
    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
    'postprocessor_args': {'extractaudio+ffmpeg_o': ['-ac', '1', '-ar', '24000']},
    'max_filesize': 100 * 1024 * 1024,
}
try:
    with YoutubeDL(options) as ydl:
        url = 'https://www.youtube.com/watch?v=' + video_id
        info = ydl.extract_info(url, download=False)
        if info.get('is_live') or info.get('age_limit', 0) > 0:
            raise ValueError('Live or age-restricted videos are not supported.')
        if not info.get('duration') or not 5 <= info['duration'] <= 600:
            raise ValueError('Choose a video between five seconds and ten minutes. The whole video will be converted.')
        ydl.process_info(info)
        audio = Path(target) / 'audio.wav'
        if not audio.exists() or audio.stat().st_size < 2048:
            raise ValueError('No audio could be read from this video.')
        if audio.stat().st_size > 100 * 1024 * 1024:
            raise ValueError('This recording exceeds the 100 MB upload limit.')
        print(json.dumps({'title': info.get('title', 'YouTube audio'),
                          'artist': info.get('uploader', ''),
                          'thumbnail': f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg',
                          'url': url, 'duration': info['duration']}))
except ValueError as exc:
    print(json.dumps({'error': str(exc)})); sys.exit(1)
except Exception as exc:
    detail = str(exc).lower()
    if 'not a bot' in detail or 'confirm you' in detail or 'http error 429' in detail:
        message = 'YouTube is blocking downloads from this hosted server. Signing in with Hugging Face does not unlock YouTube access. Please upload an audio file instead.'
    elif 'private video' in detail or 'sign in' in detail or 'age-restricted' in detail or 'age restricted' in detail:
        message = 'This video requires YouTube account access. Choose an unrestricted public video or upload an audio file.'
    elif 'video unavailable' in detail or 'removed' in detail or 'not available' in detail:
        message = 'This YouTube video is unavailable to the server. Choose another video or upload an audio file.'
    elif '403' in detail:
        message = 'YouTube refused the audio download from this server. Please upload an audio file instead.'
    elif 'timed out' in detail or 'timeout' in detail:
        message = 'YouTube took too long to respond. Try again shortly or upload an audio file.'
    else:
        message = 'The server could not download this YouTube audio. Try another public video or upload an audio file.'
    print(json.dumps({'error': message})); sys.exit(1)
