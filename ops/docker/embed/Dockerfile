# 轻量 embedding 服务（假 ollama：fastembed ONNX CPU，1024d multilingual-e5-large）
# 底座：memos-api:local（本地已有 python3.11+fastapi，零外网基础层下载）
# 模型不烧镜像：首启下载到 /data/fastembed（volume 持久化），搬家随数据卷走
FROM memos-api:local

ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    HF_ENDPOINT=https://hf-mirror.com \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir "fastembed==0.8.0"

COPY server.py /app/server.py

EXPOSE 11434
WORKDIR /app
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "11434"]
