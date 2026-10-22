ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --fund=false
COPY src ./src
COPY public ./public
COPY config.example.json ./
ENV PORTAL_DATA_DIR=/data
USER node
CMD ["node", "src/main.mjs"]
