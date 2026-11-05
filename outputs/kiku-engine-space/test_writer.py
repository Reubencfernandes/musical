"""Reading the lyric writer's replies: songs, instrumentals and enhanced styles."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import writer

failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + str(detail)))
    if not condition:
        failures.append(label)


def fails(call):
    try:
        call()
    except ValueError:
        return True
    return False


print("read_song")
reply = '''Here you go:
```json
{"style": "indie pop, bright, acoustic guitar, warm female vocal, upbeat",
 "lyrics": "[Verse 1]\\nMorning light across the floor\\n\\n\\nOpen up the door\\n[CHORUS]\\nSing it loud\\n[Instrumental]",
 "bpm": "118.4", "key": "f# MINOR"}
```'''
style, lyrics, meta = writer.read_song(reply)
check("style kept on one line", style == "indie pop, bright, acoustic guitar, warm female vocal, upbeat", style)
check("tags tidied", lyrics == "[verse]\nMorning light across the floor\n\nOpen up the door\n\n[chorus]\nSing it loud\n\n[inst]", lyrics)
check("tempo and key read", meta == {"bpm": 118, "keyscale": "F# minor"}, meta)
check("silly tempo dropped", writer.read_song('{"style":"x","lyrics":"[verse]\\nla","bpm":999,"key":"H major"}')[2] == {})
check("instrumental has no lyrics", writer.read_song('{"style":"lofi, instrumental","lyrics":"[verse]\\nla"}', True)[1] == "")
check("empty lyrics refused", fails(lambda: writer.read_song('{"style":"pop","lyrics":"[verse]\\n[chorus]"}')))
check("no JSON refused", fails(lambda: writer.read_song("Sorry, I can't help with that.")))
check("empty style refused", fails(lambda: writer.read_song('{"style":" ","lyrics":"[verse]\\nla"}')))
_, _, with_art = writer.read_song('{"style":"folk","lyrics":"[verse]\\nGoing home","artwork":"A quiet road  at dawn."}')
check("visual brief kept with song metadata", with_art["artwork"] == "A quiet road at dawn.")
check("malformed optional art does not lose the song", "artwork" not in writer.read_song('{"style":"folk","lyrics":"[verse]\\nGoing home","artwork":{"text":"bad"}}')[2])

print("read_style")
style, meta = writer.read_style('{"style": "dream pop, hazy synths, slow", "bpm": null, "key": null}')
check("enhanced style read", style == "dream pop, hazy synths, slow" and meta == {}, (style, meta))

print("messages")
m = writer.song_messages("a song about rain", False, "Spanish")
check("language passed on", "Spanish" in m[1]["content"] and m[0]["content"] == writer.SONG)
check("instrumental prompt", writer.song_messages("x", True)[0]["content"] == writer.INSTRUMENTAL)
check("measured tempo passed on", "96 BPM in D minor" in writer.enhance_messages("rock", "", {"bpm": 96, "keyscale": "D minor"})[1]["content"])

print("artwork")
import json
art = writer.artwork_messages("Going Home", "quiet folk", "[verse]\nGoing home through rain", "a long journey")
check("art director receives song context as data", json.loads(art[1]["content"])["lyrics"] == "[verse]\nGoing home through rain")
check("art director reads story and mood", "emotional arc" in art[0]["content"] and "No quoted lyrics" in art[0]["content"])
check("brief extracted from fenced JSON", writer.read_artwork('```json\n{"artwork":"A rain-soaked road at dawn."}\n```') == "A rain-soaked road at dawn.")
check("brief bounded", len(writer.read_artwork(json.dumps({"artwork": "sky " * 300}))) == 600)
for bad in (None, {}, [], 42, "  "):
    check("invalid brief refused: " + repr(bad), fails(lambda: writer.read_artwork(json.dumps({"artwork": bad}))))

if failures:
    sys.exit("%d failed" % len(failures))
print("all passed")
