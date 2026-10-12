"""Create and push the Kiku AI frontend as a CPU Docker Space.

Usage (PowerShell):
    $env:HF_TOKEN = "hf_your_token"   # or sign in once with `hf auth login`
    python work/deploy_kiku_app.py

ZeroGPU only supports the Gradio SDK, so the frontend cannot be a GPU Space. It
runs on CPU here and calls the three Gradio engines over HTTP using each
signed-in user's own token, which is what makes the GPU cost fall on the visitor
rather than the owner.

SESSION_SECRET is generated and stored as a Space secret on first creation only.
Rotating it logs every user out, so a re-run leaves an existing one alone unless
--rotate-secret is passed.
"""
import os
import secrets
import sys
from pathlib import Path

# Some machines inspect HTTPS with a root certificate that lives in the OS store
# but not in certifi's bundle. Verify against the OS store when it is available;
# verification itself is never turned off.
try:
    import truststore
except ImportError:
    try:
        from pip._vendor import truststore
    except ImportError:
        truststore = None
if truststore:
    truststore.inject_into_ssl()

from huggingface_hub import HfApi

from huggingface_hub.utils import RepositoryNotFoundError

OWNER = "Reubencf"
NAME = "Kiku-AI"
REPO = "%s/%s" % (OWNER, NAME)
# Must match a redirect_uri registered in the API Space's oauth_metadata(),
# or sign-in fails with a redirect mismatch.
ORIGIN = "https://reubencf-kiku-ai.hf.space"
FOLDER = Path(__file__).resolve().parent.parent / "outputs" / "kiku-ai"

VARIABLES = {
    "APP_ORIGIN": ORIGIN,
    # One Gradio ZeroGPU Space holds every model; this Docker Space is only the UI.
    "HF_ENGINE_SPACE": "Reubencf/Kiku-Engine",
    "HF_ENGINE_ORIGIN": "https://reubencf-kiku-engine.hf.space",
    "HF_OAUTH_CLIENT_ID": "https://reubencf-kiku-engine.hf.space/.well-known/oauth-cimd",
    # ACE-Step 1.5 runs on its own Space; the studio lets users pick it or YuE2.
    "HF_ACE15_SPACE": "Reubencf/Kiku-ACE-Step-15",
    "HF_ACE15_ORIGIN": "https://reubencf-kiku-ace-step-15.hf.space",
}
IGNORE = ["node_modules/*", ".next/*", ".env*", "*.tsbuildinfo", "__pycache__/*",
          "*.pyc", ".git/*"]


def main():
    if not (FOLDER / "Dockerfile").is_file():
        sys.exit("No Dockerfile in %s" % FOLDER)
    api = HfApi(token=os.environ.get("HF_TOKEN"))
    try:
        print("Signed in as %s" % api.whoami().get("name"))
    except Exception as exc:
        sys.exit("Could not sign in to Hugging Face (%s). Set HF_TOKEN or run `hf auth login`: "
                 "https://huggingface.co/settings/tokens" % exc)

    try:
        api.space_info(REPO)
        existed = True
    except RepositoryNotFoundError:
        existed = False
    print("%s %s" % (REPO, "already exists" if existed else "will be created"))

    api.create_repo(REPO, repo_type="space", space_sdk="docker",
                    exist_ok=True, private=False)

    for key, value in VARIABLES.items():
        api.add_space_variable(REPO, key, value)
    print("Set %d variables" % len(VARIABLES))

    rotate = "--rotate-secret" in sys.argv
    if not existed or rotate:
        api.add_space_secret(REPO, "SESSION_SECRET", secrets.token_hex(32))
        print("SESSION_SECRET %s" % ("rotated (all users signed out)" if rotate else "generated"))
    else:
        print("SESSION_SECRET left as is (pass --rotate-secret to replace)")

    api.upload_folder(repo_id=REPO, repo_type="space", folder_path=str(FOLDER),
                      ignore_patterns=IGNORE, commit_message="Deploy Kiku AI",
                      # Samples removed locally are removed from the Space too.
                      delete_patterns=["public/soundfonts/**"])
    print("Uploaded %s" % FOLDER.name)
    print("\n%s" % ORIGIN)
    print("https://huggingface.co/spaces/%s" % REPO)
    print("\nDocker builds the Next.js app from source, so the first build takes\n"
          "several minutes. Sign-in needs %s/auth/callback listed in the API\n"
          "Space's oauth_metadata(); redeploy that Space if you change the name." % ORIGIN)


if __name__ == "__main__":
    main()
