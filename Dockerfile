# minecraft-ai-friend 世界进程镜像。
#
# build context 必须是「同时包含 deepseek-harness/ 与 minecraft-ai-friend/ 的目录」
# （workspace 根；两个仓平级、各自独立 checkout 时天然满足）：
#
#   docker build -f minecraft-ai-friend/Dockerfile -t mc-world .
#
# @deepseek-ai/* 不在 npm 上，由 harness 的 vendor + packages 经 symlink 提供
# （Windows 侧等价物是 setup-vendor-links.bat 的 junction）。
#
# 世界进程不启 viewer（女神无需被观察），prismarine-viewer 的 canvas 全家桶
# 全部走 --omit=optional 跳过；唯一原生模块 better-sqlite3 有 linux prebuilt。
FROM node:22-bookworm-slim

# python3/make/g++ 仅作 better-sqlite3 prebuilt 缺失时的编译兜底。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) 依赖层（package*.json 不变则缓存命中）
COPY minecraft-ai-friend/package.json minecraft-ai-friend/package-lock.json ./
RUN npm install --omit=optional --no-audit --no-fund \
  --registry=https://registry.npmmirror.com \
  && npm install --no-save --no-audit --no-fund tsx \
  --registry=https://registry.npmmirror.com

# 2) dsh 底座（vendor + packages，symlink 进 node_modules 等价 junction）
COPY deepseek-harness/vendor /dsh/vendor
COPY deepseek-harness/packages /dsh/packages
RUN mkdir -p node_modules/@deepseek-ai \
  && ln -s /dsh/vendor/cordis node_modules/@deepseek-ai/cordis \
  && ln -s /dsh/vendor/schemastery node_modules/@deepseek-ai/schemastery \
  && ln -s /dsh/vendor/timer node_modules/@deepseek-ai/cordis-plugin-timer \
  && ln -s /dsh/packages/core/system-prompt node_modules/@deepseek-ai/dsh-system-prompt \
  && ln -s /dsh/packages/core/tools node_modules/@deepseek-ai/dsh-tools

# 3) 本仓源码（data/ 运行时数据由 volume 挂载，不进镜像）
COPY minecraft-ai-friend/src ./src
COPY minecraft-ai-friend/bootstrap-world.mts minecraft-ai-friend/tsconfig.json ./
COPY minecraft-ai-friend/web-panel.mjs ./

# 观察面板（同镜像第二用途：docker compose 的 panel 服务直接换 command 跑）
EXPOSE 9090

# 入口：RCON 密码经 env 注入 secrets 文件（mc-rcon 只读文件），再起世界进程。
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p data && if [ -n \"$RCON_PASSWORD\" ]; then printf '%s' \"$RCON_PASSWORD\" > data/rcon-secret.txt; fi && exec npx tsx bootstrap-world.mts"]
