"""Keep torchaudio's file I/O working without TorchCodec.

From torchaudio 2.9 both ``load`` and ``save`` delegate to TorchCodec, and raise
ImportError when it is absent. TorchCodec has to match the exact torch build, and
ACE-Step leaves torch unpinned so ZeroGPU can choose it — pinning a matching
TorchCodec here would be guesswork that breaks whenever that choice moves.

soundfile and librosa are already dependencies and cover every format this Space
accepts, so the two functions are redirected to them instead. ACE-Step asks for
the ``soundfile`` backend at its call site anyway; this just makes that real.

Import this before ``acestep``.
"""
import librosa
import numpy as np
import soundfile as sf
import torch
import torchaudio


def _load(uri, frame_offset=0, num_frames=-1, normalize=True, channels_first=True, **kwargs):
    """Return (waveform, sample_rate) shaped the way torchaudio does."""
    audio, rate = librosa.load(str(uri), sr=None, mono=False)
    if audio.ndim == 1:
        audio = audio[None, :]
    if frame_offset:
        audio = audio[:, int(frame_offset):]
    if num_frames and num_frames > 0:
        audio = audio[:, :int(num_frames)]
    tensor = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
    return (tensor if channels_first else tensor.T), int(rate)


def _save(uri, src, sample_rate, channels_first=True, format=None, backend=None, **kwargs):
    """Write a tensor to disk, taking the container from the file extension."""
    audio = src.detach().cpu().float().numpy()
    if audio.ndim == 1:
        audio = audio[None, :]
    if not channels_first:
        audio = audio.T
    # soundfile takes frames-first, the opposite of torchaudio's layout.
    sf.write(str(uri), audio.T, int(sample_rate))
    return None


def apply():
    torchaudio.load = _load
    torchaudio.save = _save
