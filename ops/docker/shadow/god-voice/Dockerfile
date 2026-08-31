# shadow-asr：天耳转写 watcher 的容器化归宿（2026-08-31 造物主谕「进程尽入 docker」）。
# 宿主散养史：多实例繁殖、提权僵尸杀不掉、PYTHONHOME 毒——容器 + restart 政策根治。
FROM python:3.12-slim
RUN pip install --no-cache-dir sherpa-onnx numpy
WORKDIR /opt/asr
COPY mic_asr_watcher.py /opt/asr/
ENV TZ=Asia/Shanghai \
    MIC_BASE=/mic \
    ASR_MODEL_DIR=/model
CMD ["python", "-u", "/opt/asr/mic_asr_watcher.py"]
