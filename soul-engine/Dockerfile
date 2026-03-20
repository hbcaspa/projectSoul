FROM node:20-alpine

# Python3 for trader-arena integration (paper_trader.py needs requests)
RUN apk add --no-cache python3 py3-pip py3-requests

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin/ bin/
COPY src/ src/

ENV SOUL_PATH=/soul

CMD ["node", "bin/cli.js", "start"]
