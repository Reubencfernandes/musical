"""Song ideas and style prompts for YuE2, written by a small open language model.

This took over from ACE-Step 1.5's language model, which Kiku AI no longer
runs: Simple mode turns a one-line idea into a style, lyrics, tempo and key,
and Enhance turns a few words into a full style prompt. The model is
Qwen3-4B-Instruct-2507 (Apache 2.0). Everything here except `write` is plain
Python, so the prompts and the checks on what comes back are tested without it.
"""
import json
import re

MODEL = "Qwen/Qwen3-4B-Instruct-2507"
REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"

SECTIONS = ("intro", "verse", "pre-chorus", "chorus", "bridge", "inst", "outro")
KEY = re.compile(r"^([A-G])([#b]?)\s*(major|minor)$", re.I)

SONG = """You write songs for YuE2, a model that sings full songs from a style line and lyrics.
Reply with one JSON object and nothing else:
{"style": "...", "lyrics": "...", "bpm": 120, "key": "A minor"}

style: one line of 6 to 12 comma-separated tags: genre, mood, the main instruments,
the voice (for example "female vocal, breathy"), production and tempo feel.
Never name real artists or songs.
lyrics: original words, with each section tag alone on its line: [verse], [chorus],
[bridge], and optionally [intro] or [outro] with no words under them. Usually verse,
chorus, verse, chorus, bridge, chorus. Two to six short singable lines per section,
a blank line between sections. No notes or explanations inside the lyrics.
bpm: a whole number that suits the style. key: a key such as "E major" or "F# minor".
Write the lyrics in the language the idea asks for; otherwise in English."""

INSTRUMENTAL = """You describe instrumental music for a model that composes from a style line.
Reply with one JSON object and nothing else:
{"style": "...", "lyrics": "", "bpm": 120, "key": "A minor"}

style: one line of 6 to 12 comma-separated tags: genre, mood, the lead and supporting
instruments, production and tempo feel, and the word "instrumental".
Never name real artists or songs. lyrics stays empty. bpm: a whole number that suits
the style. key: a key such as "E major" or "F# minor"."""

ENHANCE = """You improve style prompts for a music model.
Rewrite the user's description as one line of 6 to 14 comma-separated tags: genre, mood,
instruments, production, the voice when the music is sung, and tempo feel. Keep
everything the user asked for and add only what fits it. Never name real artists or songs.
Reply with one JSON object and nothing else: {"style": "...", "bpm": 120, "key": "A minor"}
Use null for bpm or key when the description gives no reason to pick one."""


def song_messages(idea, instrumental=False, language=""):
    ask = "Idea: " + idea.strip()
    if language.strip():
        ask += "\nLanguage of the lyrics: " + language.strip()
    return [{"role": "system", "content": INSTRUMENTAL if instrumental else SONG},
            {"role": "user", "content": ask}]


def enhance_messages(caption, lyrics="", measured=None):
    ask = "Description: " + caption.strip()
    ask += "\nThe music is sung." if lyrics.strip() else "\nThe music may be instrumental."
    if measured and measured.get("bpm"):
        ask += "\nThe recording is at %d BPM" % measured["bpm"]
        ask += " in %s." % measured["keyscale"] if measured.get("keyscale") else "."
    return [{"role": "system", "content": ENHANCE}, {"role": "user", "content": ask}]


def _object(reply):
    """The JSON object in a reply, even when it comes wrapped in a code fence or prose."""
    start, end = reply.find("{"), reply.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("The writer did not return a song. Try again.")
    try:
        value = json.loads(reply[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError("The writer returned something unreadable. Try again.") from exc
    if not isinstance(value, dict):
        raise ValueError("The writer did not return a song. Try again.")
    return value


def _style(value):
    style = " ".join(str(value or "").split()).strip(" ,.")
    if not style:
        raise ValueError("The writer left the style empty. Try again.")
    return style[:600]


def _bpm(value):
    try:
        bpm = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return bpm if 40 <= bpm <= 220 else None


def _key(value):
    found = KEY.match(" ".join(str(value or "").split()))
    return "%s%s %s" % (found[1].upper(), found[2], found[3].lower()) if found else None


def tidy_lyrics(text):
    """Section tags lower-cased and alone on their lines, one blank line between sections."""
    out = []
    for raw in str(text or "").replace("\r", "").split("\n"):
        line = raw.strip()
        tag = re.fullmatch(r"\[\s*([A-Za-z -]+?)\s*\d*\s*\]", line)
        if tag:
            name = tag[1].lower().replace(" ", "-")
            name = {"instrumental": "inst", "prechorus": "pre-chorus", "hook": "chorus"}.get(name, name)
            if out and out[-1] != "":
                out.append("")
            out.append("[%s]" % name)
        elif line:
            out.append(line)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()[:8000]


def read_song(reply, instrumental=False):
    """(style, lyrics, meta) from the writer's reply, or a ValueError the user can act on."""
    value = _object(reply)
    lyrics = "" if instrumental else tidy_lyrics(value.get("lyrics"))
    if not instrumental and not re.search(r"^[^\[\n].*$", lyrics, re.M):
        raise ValueError("The writer left the lyrics empty. Try again.")
    meta = {k: v for k, v in (("bpm", _bpm(value.get("bpm"))), ("keyscale", _key(value.get("key")))) if v}
    return _style(value.get("style")), lyrics, meta


def read_style(reply):
    """(style, meta) from the writer's reply to an enhance request."""
    value = _object(reply)
    meta = {k: v for k, v in (("bpm", _bpm(value.get("bpm"))), ("keyscale", _key(value.get("key")))) if v}
    return _style(value.get("style")), meta


def write(model, tokenizer, messages, max_new_tokens=900):
    """Run the model on a chat; sampling settings are Qwen's own recommendation."""
    import torch
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=True,
                             temperature=0.7, top_p=0.8, top_k=20)
    return tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
