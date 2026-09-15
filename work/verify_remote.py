"""Run one generated music excerpt through the deployed Space."""
from pathlib import Path
import json
import os
import time
from huggingface_hub import HfApi, get_token
from gradio_client import Client, handle_file

repo = 'Reubencf/Audio-to-Score'
api = HfApi()
for attempt in range(60):
    runtime = api.get_space_runtime(repo)
    print('Space:', runtime.stage, flush=True)
    if runtime.stage == 'RUNNING':
        break
    if runtime.stage in ('BUILD_ERROR', 'RUNTIME_ERROR'):
        raise RuntimeError(str(runtime))
    time.sleep(10)
else:
    raise TimeoutError('Space startup exceeded 10 minutes')

client = Client(repo, hf_token=get_token(), download_files=str(Path('work/remote-result').resolve()))
print('Connected to conversion endpoint.', flush=True)
audio_path = Path(os.environ.get('SCORE_TEST_AUDIO', 'work/test-melody.wav')).resolve()
duration = int(os.environ.get('SCORE_TEST_DURATION', '10'))
job = client.submit(handle_file(str(audio_path)),
                    0, duration, False, True, api_name='/transcribe')
last = None
while not job.done():
    status = job.status()
    current = str(status.code) + ' ' + str(status.progress_data)
    if current != last:
        print(current, flush=True)
        last = current
    time.sleep(10)
result = job.result()
Path('work/remote-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2), flush=True)
assert result[2] and Path(result[2]).read_bytes().startswith(b'%PDF'), 'Missing printable PDF'
assert result[3] and Path(result[3]).stat().st_size > 44, 'Missing piano preview'
assert result[5].strip(), 'Missing ABC notation'
assert result[1], 'Missing score preview'
assert any(Path(p).suffix == '.mid' for p in result[4]), 'Missing MIDI'
print('PASS: actual inference returned PDF, PNG, ABC, MIDI, ZIP and piano playback.', flush=True)
