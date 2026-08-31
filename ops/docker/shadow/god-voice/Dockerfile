# shadow-asr / shadow-voice 共用嗓子里程碑镜像（2026-08-31 进程收编 docker）：
# asr=天耳转写（mic_asr_watcher 常驻）；voice=天音合成（sidecar/god-voice-watcher.py bind 挂入）。
# 宿主散养史：多实例繁殖、提权僵尸杀不掉、PYTHONHOME 毒——容器 + restart 政策根治。
FROM python:3.12-slim
RUN pip install --no-cache-dir sherpa-onnx numpy edge-tts
WORKDIR /opt/asr
COPY mic_asr_watcher.py /opt/asr/
ENV TZ=Asia/Shanghai \
    MIC_BASE=/godvoice/mic \
    ASR_MODEL_DIR=/model
CMD ["python", "-u", "/opt/asr/mic_asr_watcher.py"]
