FROM qiandengji-qwenpaw-game:2.2.0-qd1
RUN python -m pip install --no-cache-dir nbtlib==2.0.4 quickjs-ng==0.16.2.1
COPY world/survival /survival
COPY world/sidecar/character_speech.py /survival/character_speech.py
ENTRYPOINT ["python", "-u", "/survival/service.py"]
