"""ZeroGPU hands out MIG slices, so CUDA_VISIBLE_DEVICES holds a "MIG-<uuid>".
vLLM's NVML platform turns that variable into integer device indexes and fails;
its non-NVML platform asks torch.cuda instead, which understands MIG. Loaded into
every Python process through a .pth file, so vLLM's own subprocesses get it too."""
import importlib.abc
import importlib.util
import os
import sys


class _UseTorchCuda(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name != "vllm.platforms.cuda":
            return None
        sys.meta_path.remove(self)
        spec = importlib.util.find_spec(name)
        run = spec.loader.exec_module

        def exec_module(module):
            run(module)
            module.CudaPlatform = module.NonNvmlCudaPlatform

        spec.loader.exec_module = exec_module
        return spec


if "MIG-" in os.environ.get("CUDA_VISIBLE_DEVICES", ""):
    sys.meta_path.insert(0, _UseTorchCuda())
