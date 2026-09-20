from pathlib import Path
import urllib.request, json, time, sys
token=Path.home().joinpath('.cache/huggingface/token').read_text().strip()
repo=sys.argv[1] if len(sys.argv)>1 else 'Reubencf/Score-Studio-API'
kind=sys.argv[2] if len(sys.argv)>2 else 'run'
request=urllib.request.Request('https://huggingface.co/api/spaces/'+repo+'/logs/'+kind,headers={'Authorization':'Bearer '+token})
lines=[];started=time.monotonic()
try:
    with urllib.request.urlopen(request,timeout=5) as response:
        while time.monotonic()-started<15:
            line=response.readline().decode()
            if not line: break
            if line.startswith('data:'):
                try:
                    item=json.loads(line[5:]).get('data',line[5:])
                    if 'INFO:httpx:' not in item: lines.append(item+'\n')
                except: lines.append(line[5:])
except TimeoutError: pass
print(''.join(lines)[-5000:])
