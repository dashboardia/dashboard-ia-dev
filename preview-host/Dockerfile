FROM node:22-bookworm-slim

ARG RAILPACK_VERSION=0.36.4

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io tar \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://railpack.com/install.sh \
    | RAILPACK_VERSION="${RAILPACK_VERSION}" sh -s -- --bin-dir /usr/local/bin \
  && railpack --version

WORKDIR /app
# O servidor importa módulos auxiliares em tempo de execução. Copiar todos os
# arquivos .mjs evita publicar uma imagem que constrói, mas encerra ao iniciar
# quando um novo módulo de runtime é adicionado.
COPY *.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
ENV RAILPACK_VERSION=${RAILPACK_VERSION}
ENV RAILPACK_FRONTEND_IMAGE=ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}
EXPOSE 8080

CMD ["node", "server.mjs"]
