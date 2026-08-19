# Dashboardia Preview Host

Serviço isolado responsável por construir, executar e remover previews temporários dos projetos dos clientes.

## Requisitos

- VPS Linux com Docker e Docker Compose.
- DNS `preview-api.dashboardia.app` apontando para o VPS.
- DNS curinga `*.preview.dashboardia.app` apontando para o VPS. O Caddy emite certificados individuais sob demanda, autorizados somente para previews ativos.
- Portas 80 e 443 liberadas.

Use uma VPS dedicada somente aos previews. O serviço controla o Docker do host e não deve compartilhar máquina com o banco, a aplicação principal ou outros dados sensíveis.

## Publicação

```bash
cp .env.example .env
# Preencha o token e o e-mail antes de continuar.
docker compose up -d --build
```

No serviço web e no worker do Dashboardia, configure o mesmo token:

```env
PREVIEW_HOST_URL=https://preview-api.dashboardia.app
PREVIEW_HOST_TOKEN=mesmo-token-do-host
PREVIEW_TTL_MINUTES=60
```

Os containers recebem 1 CPU, 768 MB de memória, limite de processos, nenhuma capability Linux adicional e uma rede interna exclusiva por preview. Assim, projetos de clientes diferentes não conseguem se comunicar. O host executa no máximo dois builds simultâneos, enfileira o restante e remove automaticamente rede, imagem e container ao vencer o TTL.
