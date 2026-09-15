"""Publish only the reviewed frontend sources; keep deployment credentials off disk."""
import sys, ssl, os, secrets
os.environ['HF_HUB_DISABLE_PROGRESS_BARS']='1'
from pathlib import Path
sys.path.append('C:/Users/USER/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0/LocalCache/local-packages/Python311/site-packages')
from huggingface_hub import HfApi

trust=Path('work/system-ca.pem').resolve()
trust.write_text(''.join(ssl.DER_cert_to_PEM_cert(cert) for cert in ssl.create_default_context().get_ca_certs(binary_form=True)))
os.environ['REQUESTS_CA_BUNDLE']=str(trust)
api=HfApi(token=Path.home().joinpath('.cache/huggingface/token').read_text().strip())
repo='Reubencf/Score-Studio'
variables=[{'key':'APP_ORIGIN','value':'https://reubencf-score-studio.hf.space'},
           {'key':'HF_API_SPACE','value':'Reubencf/Score-Studio-API'},
           {'key':'HF_API_ORIGIN','value':'https://reubencf-score-studio-api.hf.space'},
           {'key':'HF_OAUTH_CLIENT_ID','value':'https://reubencf-score-studio-api.hf.space/.well-known/oauth-cimd'}]
if not api.repo_exists(repo,repo_type='space'):
    api.create_repo(repo,repo_type='space',space_sdk='docker',space_hardware='cpu-basic',private=False,
                    space_secrets=[{'key':'SESSION_SECRET','value':secrets.token_hex(32)}],space_variables=variables)
else:
    current=api.get_space_variables(repo)
    for item in variables:
        if item['key'] not in current or current[item['key']].value != item['value']:
            api.add_space_variable(repo,**item)

allowed=['app/**','components/**','lib/**','public/**','scripts/**','types/**',
         'Dockerfile','.dockerignore','.gitignore','README.md','package.json','package-lock.json',
         'next.config.ts','next-env.d.ts','tsconfig.json','env.example']
commit=api.upload_folder(repo_id=repo,repo_type='space',folder_path='outputs/score-studio',
    allow_patterns=allowed,ignore_patterns=['**/__pycache__/**','**/*.pyc','.env*'],
    commit_message='Schedule score notes live to eliminate full-score rendering on instrument changes')
print('Published',repo,'commit',commit.oid,flush=True)
print('Runtime:',api.get_space_runtime(repo).stage,flush=True)
