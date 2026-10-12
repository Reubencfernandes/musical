"""Read recent Space errors without exposing authentication values."""
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
from concurrent.futures import ThreadPoolExecutor
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi

def recent(name):
    lines = ''.join(HfApi().fetch_space_logs('Reubencf/' + name)).splitlines()
    safe = '\n'.join(lines[-90:])
    safe = re.sub(r'hf_[A-Za-z0-9_]+', '[REDACTED]', safe)
    safe = re.sub(r'(?i)Bearer\s+\S+', 'Bearer [REDACTED]', safe)
    safe = re.sub(r'(?i)([?&](?:token|allowToken|access_token|refresh_token|code)=)[^\s&"]+', r'\1[REDACTED]', safe)
    return name + '\n' + safe[-13000:]

with ThreadPoolExecutor(max_workers=3) as pool:
    for output in pool.map(recent, sys.argv[1:] or ['Kiku-AI', 'Kiku-Engine']):
        print(output, flush=True)
