"""Inspect the pinned public runtime archive without installing or importing it."""
import io
import re
import urllib.request
import zipfile
from pip._vendor import truststore
truststore.inject_into_ssl()
url = 'https://huggingface.co/m-a-p/YuE2-3B/resolve/14fc6c6f146441b1dd6363fcb2e01e82a6914cb7/yue2_infer-0.1.5-py3-none-any.whl'
with urllib.request.urlopen(url, timeout=40) as response:
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
for name in archive.namelist():
    if name.endswith('.py') and any(s in name for s in ('pipeline', 'result', 'plan')):
        body = archive.read(name).decode('utf-8')
        print(name)
        lines = body.splitlines()
        for index, line in enumerate(lines):
            if re.search(r'^class SymbolicPlan|^    def (plan|__call__)', line):
                print('\n'.join(lines[index:index+32]))
