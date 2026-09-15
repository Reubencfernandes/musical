"""An isolated score reader whose piano and cursor share the same music clock."""
import html
import json
from pathlib import Path

ASSETS = Path(__file__).parent / "player_assets"
DEMO = 'X:1\nT:Try the score player\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\n"C"C D E G|"F"A G F E|"G"D E F G|"C"E D C2|]'


def player_document(abc):
    template = (ASSETS / "player.html").read_text(encoding="utf-8")
    # ABC is data, never executable HTML, including model-generated titles.
    payload = json.dumps(abc).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return template.replace("/*PLAYER_CSS*/", (ASSETS / "abcjs-audio.css").read_text()).replace(
        "/*PLAYER_LIBRARY*/", (ASSETS / "abcjs.js").read_text(encoding="utf-8")
    ).replace("/*SCORE_DATA*/null", payload)


def score_player(abc):
    if not abc.strip():
        return '<p style="padding:24px">Your interactive score will appear here after conversion.</p>'
    return '<iframe title="Interactive sheet music player" sandbox="allow-scripts" allow="autoplay" style="width:100%;height:700px;border:0;border-radius:16px" srcdoc="' + html.escape(player_document(abc), quote=True) + '"></iframe>'
