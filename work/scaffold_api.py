from pathlib import Path
import re, shutil, urllib.request
src=Path('outputs/sheetsage2-space')
dst=Path('outputs/score-studio-api');dst.mkdir(exist_ok=True)
for name in ['requirements.txt','packages.txt']:
    shutil.copyfile(src/name,dst/name)
code=(src/'app.py').read_text(encoding='utf-8')
code=code.replace('from score_player import score_player, DEMO','from fastapi import FastAPI\nimport uvicorn')
code=code.replace('A private, queued audio-to-score interface for SheetSage2.','The dedicated ZeroGPU transcription API for Score Studio.')
code=code.replace(', score_player("")','').replace(', score_player(abc)','')
code=code[:code.index('with gr.Blocks(')]
code+='''with gr.Blocks(title="Score Studio API", delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Score Studio API\\nThe ZeroGPU transcription engine for Score Studio. "
                "Use the API below to turn audio into editable ABC, MIDI, PDF and piano audio.")
    audio = gr.Audio(type="filepath", label="Audio", sources=["upload"])
    start = gr.Number(value=0, label="Start (seconds)", minimum=0)
    duration = gr.Number(value=30, label="Duration (seconds)", minimum=5, maximum=600)
    melody = gr.Checkbox(value=False, label="Melody only")
    piano = gr.Checkbox(value=True, label="Render piano preview")
    run = gr.Button("Transcribe")
    status = gr.Textbox(label="Status")
    gallery = gr.Gallery(label="Score pages")
    pdf = gr.File(label="PDF")
    preview = gr.Audio(label="Piano preview")
    downloads = gr.File(label="Downloads", file_count="multiple")
    abc = gr.Code(label="ABC notation", language=None)
    run.click(transcribe, [audio, start, duration, melody, piano],
              [status, gallery, pdf, preview, downloads, abc],
              api_name="transcribe", concurrency_limit=1)
    gr.Markdown("Powered by [SheetSage2](https://huggingface.co/m-a-p/SheetSage2), "
                "CC BY-NC 4.0. Temporary files expire after 24 hours.")

app = FastAPI()

@app.get("/.well-known/oauth-cimd")
def oauth_metadata():
    return {
        "client_id": "https://reubencf-score-studio-api.hf.space/.well-known/oauth-cimd",
        "client_name": "Score Studio",
        "client_uri": "https://huggingface.co/spaces/Reubencf/Score-Studio-API",
        "redirect_uris": [
            "http://localhost/auth/callback", "http://127.0.0.1/auth/callback",
            "https://reubencf-score-studio.hf.space/auth/callback",
        ],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "scope": "openid profile",
    }

@app.get("/health")
def health():
    return {"status": "ready", "model": MODEL_ID, "revision": REVISION}

app = gr.mount_gradio_app(app, demo.queue(max_size=5), path="/", max_file_size="100mb", show_error=False)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
'''
(dst/'app.py').write_text(code,encoding='utf-8')
(dst/'README.md').write_text('''---
title: Score Studio API
emoji: 🎼
colorFrom: yellow
colorTo: red
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
python_version: 3.10.13
short_description: ZeroGPU audio to editable notation, MIDI and printable scores
models:
  - m-a-p/SheetSage2
tags:
  - audio-to-score
  - zerogpu
  - music-transcription
---

# Score Studio API

A separate ZeroGPU engine for Score Studio, built by [Reubencf](https://huggingface.co/Reubencf).

`/transcribe` accepts audio, start seconds, duration seconds (5–600), melody-only and piano-preview flags.
Returns status, score images, PDF, piano WAV, downloads (ABC, MIDI, ZIP) and editable ABC notation.
Requests are queued one at a time. Uploads are limited to 100 MB and temporary results expire after 24 hours.
Call with the signed-in user's Hugging Face token to use that user's ZeroGPU allowance.

The model produces a lead sheet of melody and chord symbols; review AI notation before performing.
SheetSage2 weights are licensed CC BY-NC 4.0 (non-commercial).
The OAuth metadata endpoint supports Score Studio and its local development callback using PKCE;
it requests only the user's public profile, without repository access.
''',encoding='utf-8')
fonts=Path('outputs/score-studio/public/fonts');fonts.mkdir(exist_ok=True)
for source,name in [('work/font-supreme-400.css','supreme-regular'),('work/font-bespoke-stencil-700.css','bespoke-stencil-bold')]:
    url='https:'+re.search(r"url\('([^']+\.woff2)'",Path(source).read_text())[1]
    (fonts/(name+'.woff2')).write_bytes(urllib.request.urlopen(url).read())
    print('Downloaded',name,(fonts/(name+'.woff2')).stat().st_size)
(fonts/'README.md').write_text('''# Fonts

Supreme Regular and Bespoke Stencil Bold by Indian Type Foundry, distributed by Fontshare.
Official sources: https://www.fontshare.com/fonts/supreme and https://www.fontshare.com/fonts/bespoke-stencil
Fontshare licensing: https://www.fontshare.com/licenses
Downloaded from the official Fontshare CSS/CDN for self-hosted web use.
''')
print('API scaffold complete')
