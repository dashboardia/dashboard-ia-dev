# Forgeboard — Dashboard IA Dev

Plataforma para centralizar projetos, demandas, execução assistida por IA, validações, Pull Requests, logs e saúde de aplicações.

## Arquitetura

- **Web:** Next.js 15, React 19 e NextAuth.
- **Banco:** PostgreSQL com Prisma ORM e migrações versionadas.
- **Autenticação:** GitHub OAuth; nenhuma senha própria.
- **Autorização:** Administrador Global e papéis por projeto (`MANAGER`, `DEVELOPER`, `VIEWER`).
- **Worker:** serviço separado que consome a fila PostgreSQL, cria uma cópia temporária do repositório, usa a Responses API com `apply_patch`, executa as validações configuradas e publica uma branch.
- **Entrega:** o Pull Request só é aberto após aprovação explícita de um Gestor.
- **Observabilidade:** logs estruturados por execução e verificação periódica das URLs de produção.
- **Revisão:** detalhe da execução com resumo, rastreabilidade Git, consumo, logs técnicos e diff antes da aprovação do PR.
- **Sincronização:** webhook GitHub assinado atualiza Pull Requests e conclui a demanda somente após o merge.
- **Auditoria:** histórico administrativo filtrável para alterações de acesso, projetos, demandas, execuções e Pull Requests.

## Fluxo de uma demanda

1. Gestor ou Desenvolvedor descreve a demanda e os critérios de aceite.
2. Gestor aprova e autoriza a execução.
3. Worker cria uma branch `forgeboard/demand-*` a partir da branch padrão.
4. A IA inspeciona o repositório com shell somente leitura e altera arquivos apenas por `apply_patch`.
5. Worker executa instalação, lint, testes e build definidos no projeto.
6. A branch é enviada ao GitHub e fica aguardando aprovação.
7. Gestor aprova a abertura de um Pull Request em modo draft.

Uma execução ativa pode ser cancelada por um Gestor. O worker encerra no próximo ponto seguro, remove o workspace e libera a demanda para uma nova tentativa com branch própria.

## Segurança do worker

- workspace temporário exclusivo por execução;
- token GitHub não é incluído no ambiente acessível aos comandos da IA;
- shell da IA aceita apenas comandos de leitura pré-aprovados;
- paths absolutos, travessia de diretório, arquivos de segredo, `.git` e workflows do GitHub são bloqueados;
- validações executam com ambiente reduzido, sem as credenciais do serviço;
- workspace removido ao terminar, inclusive em caso de erro;
- até três tentativas para trabalhos interrompidos.

Conecte somente repositórios administrados e confiáveis. Scripts de instalação e teste pertencem ao próprio repositório e executam dentro do container do worker.

## Desenvolvimento local

Requisitos: Node.js 22 e PostgreSQL.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Em outro terminal:

```bash
npm run worker
```

Validações:

```bash
npm run lint
npm test
npm run build
```

## Variáveis de ambiente

| Variável | Serviço | Finalidade |
|---|---|---|
| `DATABASE_URL` | Web e worker | Conexão PostgreSQL |
| `GITHUB_ID` | Web | Client ID do GitHub OAuth App |
| `GITHUB_SECRET` | Web | Client secret do GitHub OAuth App |
| `GITHUB_WEBHOOK_SECRET` | Web | Segredo HMAC usado para assinar e validar webhooks |
| `ADMIN_GITHUB_LOGIN` | Web | Login GitHub promovido a Administrador Global |
| `NEXTAUTH_SECRET` | Web | Assinatura das sessões |
| `NEXTAUTH_URL` | Web | URL pública da aplicação |
| `OPENAI_API_KEY` | Web e worker | Autorizar e executar demandas |
| `OPENAI_MODEL` | Worker | Modelo, padrão `gpt-5.6` |
| `WORKER_POLL_INTERVAL_MS` | Worker | Intervalo da fila, padrão 5000 ms |
| `HEALTH_CHECK_INTERVAL_MS` | Worker | Intervalo de monitoramento, padrão 5 minutos |
| `HEALTH_CHECK_RETENTION_DAYS` | Worker | Retenção do histórico de saúde, padrão 30 dias |
| `RAILWAY_API_TOKEN` | Web | Reservado para integração avançada com a API Railway |

O callback do GitHub OAuth em produção é:

```text
https://dashboard-ia-dev-production.up.railway.app/api/auth/callback/github
```

O endpoint de webhook GitHub é configurado automaticamente em cada projeto conectado:

```text
https://dashboard-ia-dev-production.up.railway.app/api/webhooks/github
```

## Railway

### Serviço web

- origem: repositório GitHub, branch `main`;
- build: `npm run build`;
- start: `npm start`;
- health check: `/api/health`;
- o startup aplica `prisma migrate deploy` quando `DATABASE_URL` está definida.

### PostgreSQL

Adicione PostgreSQL ao mesmo projeto e referencie a variável do banco no serviço web e no worker.

### Serviço worker

Crie um segundo serviço a partir do mesmo repositório:

- Dockerfile: `Dockerfile.worker`;
- start command: `npm run worker`;
- sem domínio público;
- variáveis obrigatórias: `DATABASE_URL`, `OPENAI_API_KEY` e `OPENAI_MODEL`.

## Permissões

| Papel | Consultar | Criar demanda | Executar | Aprovar / abrir PR | Gerenciar membros |
|---|---:|---:|---:|---:|---:|
| Visualizador | Sim | Não | Não | Não | Não |
| Desenvolvedor | Sim | Sim | Não | Não | Não |
| Gestor | Sim | Sim | Sim | Sim | Sim |
| Administrador Global | Tudo | Tudo | Tudo | Tudo | Tudo |

## Estado atual

Implementados: autenticação e RBAC, administração segura de usuários, projetos, membros, demandas, aprovação, fila, worker com IA, branch isolada, validações, Pull Request, sincronização de merge por webhook, logs, auditoria administrativa, saúde, migrações, CI e deploy Railway.

Planejado para evolução posterior: Azure DevOps e integração detalhada de logs do Railway.
