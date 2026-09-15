import sys, ssl, os
from pathlib import Path
sys.path.append('C:/Users/USER/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0/LocalCache/local-packages/Python311/site-packages')
from huggingface_hub import HfApi
trust=Path('work/system-ca.pem').resolve()
trust.write_text(''.join(ssl.DER_cert_to_PEM_cert(cert) for cert in ssl.create_default_context().get_ca_certs(binary_form=True)))
os.environ['REQUESTS_CA_BUNDLE']=str(trust)
api=HfApi(token=Path.home().joinpath('.cache/huggingface/token').read_text().strip())
repo='Reubencf/Score-Studio-API'
compile(Path('outputs/score-studio-api/app.py').read_text(encoding='utf-8'),'app.py','exec')
if not api.repo_exists(repo,repo_type='space'):
    api.create_repo(repo,repo_type='space',space_sdk='gradio',space_hardware='zero-a10g',private=False)
commit=api.upload_folder(repo_id=repo,repo_type='space',folder_path='outputs/score-studio-api',ignore_patterns=['__pycache__/**'],commit_message='Keep the API focused on stable ZeroGPU transcription')
print('Created API Space:',repo,'commit:',commit.oid)
print('Runtime:',api.get_space_runtime(repo).stage)
