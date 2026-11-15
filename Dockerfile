# Wersja serwerowa: działa 24/7 na mini-PC / NAS / Raspberry Pi 4-5 / VPS.
# Obraz Playwright ma już Chromium i biblioteki systemowe – wersja MUSI być zgodna z "playwright" w package.json.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

ENV NODE_ENV=production \
    IN_DOCKER=1 \
    HOST=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PROFILE_DIR=/data/browser-profile \
    HISTORY_FILE=/data/history.json \
    TZ=Europe/Warsaw

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public

# root w kontenerze: brak problemów z uprawnieniami do ./data (Chromium dostaje --no-sandbox przez IN_DOCKER)
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/manifest.webmanifest').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
