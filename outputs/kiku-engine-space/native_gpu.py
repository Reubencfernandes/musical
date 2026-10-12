"""Serialize the shared CUDA handlers on Modal without ZeroGPU leases."""
from functools import wraps
from threading import RLock

lock = RLock()
after_call = None


def GPU(*, duration=None):
    def decorate(function):
        @wraps(function)
        def invoke(*args, **kwargs):
            with lock:
                result = function(*args, **kwargs)
                if after_call is not None:
                    after_call()
                return result
        return invoke
    return decorate
