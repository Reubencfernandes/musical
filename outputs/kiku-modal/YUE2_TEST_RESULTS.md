# YuE2 deployment verification — 11 October 2026

YuE2 is deployed privately as `kiku-yue2` in `konkanillm/main`. Its health
endpoint reports **NVIDIA L40S**, the **torch** backend, and enabled CPU memory
snapshots. The worker has zero minimum containers, one maximum container and
a 120-second idle window. YuE2 and VAE revisions are pinned in
`yue2-model-revisions.json`.

Two real Generate-page vocal jobs completed through `/api/modal/jobs` on Modal.
The runtime reported 74.9 seconds of audio in 59.5 seconds and 215.8 seconds of
audio in 92.8 seconds. These are different randomly seeded songs, not a benchmark
comparison. The runtime timings exclude worker allocation and HTTP downloads.
The first saved FLAC was checked with FFprobe: stereo, 48 kHz, 74.878667 seconds.
The final longer FLAC was 40,791,570 bytes and decoded and converted to MP3 in
the browser; Generate displayed it as a YuE2 song of 3:35.

Browser verification confirmed that Simple passes the selected YuE2 model through
the ACE-Step caption/lyrics planning step, Custom submits the selected ACE-Step
model, and switching modes retains the model selection. YuE2 vocal duration
displays Auto. Real ACE-Step instrumental generation also passed after the shared
API changes. Generation uses app routes; no Modal proxy credentials or Hugging
Face generation token are sent to the browser for these jobs.

Both workers now serve the committed original files under `/results` instead of
Gradio's worker-local cache. Browser checks for the existing long YuE2 result were
replayed without another GPU generation, verifying its full FLAC transfer, MP3
preparation, model label, user ownership, tamper rejection, anonymous rejection,
cross-site rejection and absence of page errors. Large FLACs are checked from
the original browser download to avoid redundant transfers and Chromium inspector
cache limits.

`work/verify-yue2-generate.cjs`, `work/verify-modal-routing.cjs`,
`work/verify-modal-access.cjs`, `work/verify-yue2-health.py` and
`work/verify-yue2-deployment.py` contain the verification procedures. Local
verification data and expiring result tickets are kept under `work`, outside
the uploaded frontend.

The frontend production build passed. Hugging Face revision
`ad96b7f994f785cab2cb1848f8e0461bf2ec1d15` is RUNNING; the deployed source matches
the local selector, model dispatch, private API and canonical encrypted-ticket
validation. Both Modal origins are configured. The live frontend GPU/download
APIs and both direct Modal health endpoints reject anonymous requests with 401.
