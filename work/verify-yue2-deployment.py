"""Verify published frontend source and live API boundaries without exposing secrets."""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work' / 'hf-deploy-deps'))
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi

api = HfApi()
repo = 'Reubencf/Kiku-AI'
info = api.space_info(repo)
print(json.dumps({'repo': repo, 'revision': info.sha, 'stage': str(info.runtime.stage)}), flush=True)
if info.runtime.stage != 'RUNNING':
    sys.exit(2)
for path in ['components/songs/Generate.tsx', 'components/songs/useSongs.ts', 'lib/jobs.ts',
             'lib/studio/engine.ts', 'lib/modal-engine.ts', 'lib/auth.ts',
             'app/api/modal/jobs/route.ts', 'app/api/modal/file/route.ts']:
    with urllib.request.urlopen(f'https://huggingface.co/spaces/{repo}/raw/{info.sha}/{path}', timeout=60) as response:
        assert response.read() == (ROOT / 'outputs' / 'kiku-ai' / path).read_bytes(), path
variables = api.get_space_variables(repo)
assert variables['MODAL_YUE2_ORIGIN'].value == 'https://konkanillm--kiku-yue2-engine-web.modal.run'
assert variables['MODAL_ENGINE_ORIGIN'].value == 'https://konkanillm--kiku-acestep15-engine-web.modal.run'
origin = 'https://reubencf-kiku-ai.hf.space'
with urllib.request.urlopen(origin+'/generate', timeout=60) as response:
    assert response.status == 200
for job in ['song', 'instrumental', 'sample']:
    request = urllib.request.Request(origin+'/api/modal/jobs?job='+job, data=b'{}', headers={'Origin':origin,'Content-Type':'application/json'})
    try:
        urllib.request.urlopen(request, timeout=60)
        raise AssertionError('Anonymous generation allowed')
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
for url in [origin+'/api/modal/file?ticket=invalid',
            'https://konkanillm--kiku-yue2-engine-web.modal.run/health',
            'https://konkanillm--kiku-acestep15-engine-web.modal.run/health']:
    try:
        urllib.request.urlopen(url, timeout=60)
        raise AssertionError('Unauthenticated private endpoint accessible')
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
print('PASS: frontend RUNNING, final sources match, both Modal origins configured, Generate accessible, private GPU and result APIs reject anonymous requests.', flush=True)
