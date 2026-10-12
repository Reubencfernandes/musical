"""Use ordinary CUDA on Modal and serialize the shared model handlers."""
from functools import wraps
from threading import RLock

lock = RLock()
after_call = None
prepared_lm = None


def GPU(*, duration=None):
    """Match the Space decorator's signature without leasing a ZeroGPU GPU."""
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
