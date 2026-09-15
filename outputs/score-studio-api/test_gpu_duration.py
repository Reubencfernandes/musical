"""Check the actual Gradio-injected call signature without loading CUDA weights."""
import ast
from pathlib import Path
import unittest

tree = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
definition = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "gpu_seconds")
namespace = {}
exec(compile(ast.Module(body=[definition], type_ignores=[]), "gpu-duration", "exec"), namespace)

class DurationTests(unittest.TestCase):
    def test_gradio_injects_progress_as_a_sixth_argument(self):
        reserve = namespace["gpu_seconds"]("audio.wav", 0, 275, False, True, object())
        self.assertGreaterEqual(reserve, 45)
        self.assertLessEqual(reserve, 300)

    def test_short_recording_does_not_reserve_full_song_budget(self):
        function = namespace["gpu_seconds"]
        self.assertLess(function("audio.wav", 0, 10, False, True), function("audio.wav", 0, 600, False, True))

if __name__ == "__main__":
    unittest.main()
