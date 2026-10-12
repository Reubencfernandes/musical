FROM ghcr.io/astral-sh/uv:0.8.22 AS uv
FROM ubuntu:24.04
COPY --from=uv /uv /usr/local/bin/uv
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    UV_PYTHON_INSTALL_DIR=/opt/python
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN uv python install 3.11 && uv venv --python 3.11 /opt/venv
WORKDIR /app
COPY requirements.txt .
RUN uv pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu && \
    uv pip install -r requirements.txt && \
    python -m playwright install --with-deps --only-shell chromium
RUN usermod -l user -d /home/user -m ubuntu && groupmod -n user ubuntu && \
    mkdir -p /home/user/.cache/huggingface && chown -R user:user /app /home/user
ENV HOME=/home/user HF_HOME=/home/user/.cache/huggingface GRADIO_ANALYTICS_ENABLED=False
USER user
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('m-a-p/SheetSage2', revision='eab522a8168e8b8b8c4856bf8609cd86198f01fe'); snapshot_download('m-a-p/MERT-v2-FullSong', revision='d8ba1c745e733b3908ce6ad16ebeb17ac7600a42', allow_patterns=['*.py', '*.json', '*.safetensors'])"
COPY --chown=user:user app.py .
EXPOSE 7860
CMD ["python", "app.py"]
