# Current verification

The dedicated public API is `Reubencf/Score-Studio-API`, running on ZeroGPU.
The updated Next.js frontend is published publicly at https://reubencf-score-studio.hf.space
in the `Reubencf/Score-Studio` CPU Docker Space.

Verified:

- Production build and TypeScript checks pass.
- Bespoke Stencil Bold headings and Supreme Regular body text render in the browser.
- Light and dark themes cover the entire page; an expanding theme wave was visually checked.
- Processing chooses one random musician and shows the back button immediately under its label.
- Anonymous, expired and tampered sessions are rejected before importing or processing audio.
- Cross-origin submissions and invalid OAuth callback state are rejected.
- Session responses expose only the public user profile; sign-out clears the session cookie.
- Hugging Face accepts the public OAuth metadata and directs the browser to its login screen.
- The supplied YouTube video `u10U7BHQQ2Y` imports completely, with title, thumbnail and 274.58 seconds of audio.
- Imported audio is normalized to mono 24 kHz and protected by the importing account's session.
- A controlled authenticated HTTP integration test sent the full song through Next.js to ZeroGPU.
  The backend completed inference/rendering in 34 seconds and returned 5,584 characters of ABC,
  11 score pages, MIDI files, PDF, piano audio and a ZIP. Downloaded PDF and WAV headers were checked.
  This test used the locally authorized HF token; it does not substitute for testing a visitor's OAuth session.

Hosted deployment checks:

- Docker build passed after using the Node base image's existing UID 1000 user.
- Hugging Face reports RUNNING for frontend commit `50b572405dadcf1f0a467c26c697e7d97e892084`.
- Homepage, public session response and both font assets return HTTP 200.
- The development animation preview returns HTTP 404 in production.
- Signed-out import/transcription requests return HTTP 401.
- Hosted login sets a Secure HttpOnly cookie and sends the correct production callback
  and PKCE challenge to Hugging Face, which accepts the authorization request.

Remaining end-to-end checks:

- The user must finish Hugging Face login in the browser so the real OAuth callback, account quota
  and signed-in browser flow can be verified.
- Check YouTube access from the hosted frontend with a real signed-in session.

The original `Reubencf/Audio-to-Score` Space was not modified by this update.
