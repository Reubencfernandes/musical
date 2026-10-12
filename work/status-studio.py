from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi
api = HfApi()
for repo in ["Reubencf/Kiku-Engine", "Reubencf/Kiku-ACE-Step-15", "Reubencf/Kiku-AI"]:
    info = api.space_info(repo)
    print(repo, info.runtime.stage if info.runtime else "unknown", info.sha, flush=True)
