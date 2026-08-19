FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates docker.io tar \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs runtime.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
