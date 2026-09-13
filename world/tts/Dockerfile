# Rebuild the audited IndexTTS 2.5 runtime without embedding weights or voices.
# tools/build_tts_runtime.py creates the small, reviewed build context.
ARG BASE_IMAGE=python:3.11-slim-bookworm@sha256:528257d48c1da0dcecc2e725d1ae34498d60c965f1241e39cd6a85a8859bdf84
FROM ${BASE_IMAGE}
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg git curl build-essential libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY source/ /app/
# CUDA libraries are supplied by the PyTorch wheel. The container GPU request
# supplies the host NVIDIA driver; no host Python environment is used.
RUN python -m pip install --no-cache-dir --index-url "$PIP_INDEX_URL" \
        torch==2.8.0 torchaudio==2.8.0 \
    && python -m pip install --no-cache-dir --index-url "$PIP_INDEX_URL" \
        fastapi==0.141.1 uvicorn==0.52.4 lameenc==1.8.4 huggingface-hub==0.36.2 \
    && python -m pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -e . \
    && python -m pip check \
    && mkdir -p /opt/qiandengji \
    && python -m pip freeze > /opt/qiandengji/tts-packages.txt
COPY tts_api.py /app/tts_api.py
COPY source-manifest.json /opt/qiandengji/tts-source-manifest.json
EXPOSE 8100
CMD ["python3", "-u", "/app/tts_api.py"]
