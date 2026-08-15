FROM ghcr.io/puppeteer/puppeteer:21.5.0

USER root

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
