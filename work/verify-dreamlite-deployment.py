"""Check the published DreamLite integration without printing credentials."""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'work'/'hf-deploy-deps'))
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi
api=HfApi()
repo='Reubencf/Kiku-AI'
info=api.space_info(repo)
print(json.dumps({'revision':info.sha,'stage':str(info.runtime.stage)}),flush=True)
if info.runtime.stage!='RUNNING':sys.exit(2)
for path in ['app/api/modal/cover/route.ts','lib/song-covers.ts','lib/library.ts',
 'components/songs/useSongs.ts','components/songs/SongArt.tsx','components/songs/SongList.tsx',
 'components/shell/Player.tsx','app/hub.css','app/api/modal/jobs/route.ts','lib/modal-engine.ts']:
 with urllib.request.urlopen(f'https://huggingface.co/spaces/{repo}/raw/{info.sha}/{path}',timeout=60) as response:
  assert response.read()==(ROOT/'outputs'/'kiku-ai'/path).read_bytes(),path
variables=api.get_space_variables(repo)
assert variables['MODAL_COVER_ORIGIN'].value=='https://konkanillm--kiku-dreamlite-artwork-web.modal.run'
origin='https://reubencf-kiku-ai.hf.space'
for path in ['/generate','/library']:
 with urllib.request.urlopen(origin+path,timeout=60) as response:assert response.status==200
request=urllib.request.Request(origin+'/api/modal/cover',data=b'{}',headers={'Origin':origin,'Content-Type':'application/json'})
for target in [request,'https://konkanillm--kiku-dreamlite-artwork-web.modal.run/health']:
 try:
  urllib.request.urlopen(target,timeout=60);raise AssertionError('Anonymous access allowed')
 except urllib.error.HTTPError as error:assert error.code==401
print('PASS: published sources match, Space RUNNING, cover GPU origin configured, pages accessible, live API and Modal GPU reject anonymous access.',flush=True)
