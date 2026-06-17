FROM node:20-alpine

# Python3 for trader-arena integration (paper_trader.py needs requests)
# Build deps (make/g++) are needed for node-pty's native compile, then removed.
RUN apk add --no-cache python3 py3-pip py3-requests zsh

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps make g++ \
 && npm ci --omit=dev \
 && apk del .build-deps

COPY bin/ bin/
COPY src/ src/

ENV SOUL_PATH=/soul

CMD ["node", "bin/cli.js", "start"]
