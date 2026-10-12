"""Contract checks for orchestration without loading models or importing the GPU app."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import scores

class Error(Exception):
    pass

class Progress:
    def __call__(self, *args, **kwargs):
        pass

fixture = (Path(__file__).parent / "fixtures/score.abc").read_text()
requests = []
def plan(**kwargs):
    requests.append(kwargs)
    return SimpleNamespace(abc=fixture, truncated=False)

tree = ast.parse((Path(__file__).parent / "app.py").read_text(encoding="utf-8"))
chosen = {"_generation_report", "plan_score", "score_instrumental"}
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in chosen]
for node in nodes:
    node.decorator_list = []
def render(abc, style, lyrics, cot, seed, **kwargs):
    requests.append({"abc": abc, "style": style, "lyrics": lyrics, "cot": cot, "seed": seed, **kwargs})
    return "instrument.flac", [], {"seed": seed, "truncated": False}
scope = {"gr": SimpleNamespace(Error=Error, Progress=Progress), "scores": scores, "json": json,
         "os": __import__("os"), "YUE2_ID": "m-a-p/YuE2-3B",
         "yue2": lambda: SimpleNamespace(plan=plan), "failed": lambda e: e,
         "_render_score": render, "INSTRUMENTAL": ["no vocals"]}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "app.py", "exec"), scope)
status, abc, report = scope["plan_score"]("acoustic jazz", "[verse]\nHello melody", 42, False)
assert scores.read(abc).vocal and json.loads(report)["seed"] == 42
assert requests[-1]["cot"] == "full"
status, instrumental, _ = scope["plan_score"]("solo piano", "", 42, True)
assert not scores.read(instrumental).vocal
assert scores.read(instrumental).ins == scores.read(fixture).vocal
result = scope["score_instrumental"]("solo piano", fixture, 30, 42)
played = scores.read(requests[-1]["abc"])
assert not played.vocal and played.ins == scores.read(fixture).vocal
assert requests[-1]["strip_voice"] is True
assert result[3] == 42 and json.loads(result[4])["truncated"] is False
assert scope["_generation_report"](SimpleNamespace(truncated={"abc": False, "semantic": False}), 1)["truncated"] is False
assert scope["_generation_report"](SimpleNamespace(truncated={"abc": False, "semantic": True}), 1)["truncated"] is True
scope["yue2"] = lambda: SimpleNamespace(plan=lambda **kwargs: SimpleNamespace(abc="incomplete native score", truncated=True))
try:
    scope["plan_score"]("solo piano", "", 42, True)
    raise AssertionError("A cut-off draft must be diagnosed before parsing")
except Error as exc:
    assert "score limit" in str(exc)
try:
    scope["plan_score"]("jazz", "", 42, False)
    raise AssertionError("Empty song lyrics must fail")
except Error:
    pass
print("PASS plan before render; instrumental melody transfer; seed; truncation; request validation")
