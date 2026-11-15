FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts fetch the platform-specific yt-dlp and ffmpeg-static binaries.
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p data && chown node:node data
ENV NODE_ENV=production
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["npm", "start"]
