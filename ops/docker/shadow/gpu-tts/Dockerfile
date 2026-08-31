# mc-tts:1.0 — 神语阁 IndexTTS 2.5 本地克隆 TTS 服务（2026-08-31 首建）
# 基座定论(当天踩坑)：不用 nvidia/cuda 基座(海外源 150KB/s 拖死)——
#   pypi 的 torch 2.8 默认 wheel 即 cu128(Blackwell sm_120 OK)，
#   cuda 运行库(cublas/cudnn等)由 pip 的 nvidia-*-cu12 依赖自带；
#   驱动层 libcuda 由 nvidia-container-toolkit 透传注入。
# 权重与嗓子库运行时 bind 挂 /checkpoints /voices，不入库。
FROM docker.m.daocloud.io/library/python:3.11-slim-bookworm

# pip 源定论(2026-08-31 实测): aliyun pypi 大 wheel 限速 86KB/s(小包裹快)、
# download.pytorch.org/nvidia registry 海外路 150-250KB/s；
# TUNA pypi 同 hash 转发实测 26.5MB/s ✓ 大件全走清华。
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple/ \
    PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn \
    HF_ENDPOINT=https://hf-mirror.com \
    PYTHONUNBUFFERED=1

# apt 换清华源 + 只装必要件（libgl/libglib 是 opencv-python 的运行依赖）
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg git curl build-essential \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 官方源码随 context 携带（容器内 git clone github 在弱网下 TLS 断流，定论走 COPY；
# 宿主副本在 ../tts/repo，升级时 robocopy 同步一份进来重建）
COPY repo/ /app/
WORKDIR /app

# torch/torchaudio 先单独装(最大件)，再补 fastapi 与主包依赖
RUN pip3 install --no-cache-dir "torch==2.8.*" "torchaudio==2.8.*" \
    && pip3 install --no-cache-dir fastapi uvicorn \
    && pip3 install --no-cache-dir -e .

COPY tts_api.py /app/tts_api.py
EXPOSE 8100
CMD ["python3", "-u", "/app/tts_api.py"]
