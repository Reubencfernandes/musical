import json
import urllib.error
import urllib.request
from pathlib import Path
from pip._vendor import truststore
truststore.inject_into_ssl()

values = {}
for line in Path('outputs/kiku-ai/.env.local').read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key] = value.strip().strip('"').strip("'")
url = values['MODAL_YUE2_ORIGIN']
try:
    urllib.request.urlopen(url + '/health', timeout=30)
    raise AssertionError('Public access to private GPU allowed')
except urllib.error.HTTPError as exc:
    assert exc.code == 401
headers = {'Modal-Key': values['MODAL_PROXY_KEY'], 'Modal-Secret': values['MODAL_PROXY_SECRET']}
with urllib.request.urlopen(urllib.request.Request(url + '/health', headers=headers), timeout=300) as response:
    health = json.load(response)
assert health['ready'] and health['model'] == 'YuE2' and 'L40S' in health['gpu']
assert health['backend'] == 'torch' and health['cpu_snapshot_enabled']
Path('work/yue2-modal-health.json').write_text(json.dumps(health, indent=2), encoding='utf-8')
print(json.dumps({'anonymous_status': 401, 'health': health}), flush=True)
