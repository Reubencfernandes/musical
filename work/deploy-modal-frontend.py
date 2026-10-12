"""Publish Kiku's Modal routing and waveform; preserve existing auth and GPU settings."""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work' / 'hf-deploy-deps'))
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi

FRONTEND = ROOT / 'outputs' / 'kiku-ai'

def settings():
    values = {}
    for line in (FRONTEND / '.env.local').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key in ('MODAL_ENGINE_ORIGIN', 'MODAL_YUE2_ORIGIN', 'MODAL_COVER_ORIGIN', 'MODAL_PROXY_KEY', 'MODAL_PROXY_SECRET'):
        values[key] = os.environ.get(key) or values.get(key)
        if not values[key]:
            raise RuntimeError(f'Missing server setting: {key}')
    return values

def main():
    values = settings()
    api = HfApi(token=os.environ.get('HF_TOKEN'))
    repo = 'Reubencf/Kiku-AI'
    api.space_info(repo)
    for key in ('MODAL_PROXY_KEY', 'MODAL_PROXY_SECRET'):
        api.add_space_secret(repo, key, values[key])
    api.add_space_variable(repo, 'MODAL_ENGINE_ORIGIN', values['MODAL_ENGINE_ORIGIN'])
    api.add_space_variable(repo, 'MODAL_YUE2_ORIGIN', values['MODAL_YUE2_ORIGIN'])
    api.add_space_variable(repo, 'MODAL_COVER_ORIGIN', values['MODAL_COVER_ORIGIN'])
    commit = api.upload_folder(
        repo_id=repo, repo_type='space', folder_path=str(FRONTEND),
        ignore_patterns=['node_modules/**', '.next/**', '.env*', '*.tsbuildinfo',
                         '**/__pycache__/**', '**/*.pyc', '.git/**', 'test-results/**'],
        commit_message='Generate private DreamLite song covers on Modal and save artwork to user libraries',
    )
    print('Published frontend commit:', commit.oid, flush=True)
    print('https://reubencf-kiku-ai.hf.space', flush=True)

if __name__ == '__main__':
    main()
