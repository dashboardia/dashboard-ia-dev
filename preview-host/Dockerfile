FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates docker.io tar \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# O servidor importa módulos auxiliares em tempo de execução. Copiar todos os
# arquivos .mjs evita publicar uma imagem que constrói, mas encerra ao iniciar
# quando um novo módulo de runtime é adicionado.
COPY *.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
