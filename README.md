# Dashboard IA Dev

Dashboard web para centralizar desenvolvimento assistido por IA, integração com repositórios, execução de demandas, Pull Requests, logs e saúde das aplicações.

## Estado atual

A interface responsiva está publicada no Railway. A fundação de produção já utiliza Next.js nativo, Prisma e PostgreSQL, com migrações automáticas no startup e endpoint de saúde em `/api/health`. Enquanto o banco e o OAuth não forem configurados, os dados da tela continuam demonstrativos.

## Tecnologias

- Next.js
- React
- Prisma ORM
- PostgreSQL
- NextAuth
- Lucide React
- ESLint

## Executar localmente

```bash
npm install
npm run db:generate
npm run dev
```

Validações disponíveis:

```bash
npm run lint
npm run build
```

Copie `.env.example` para `.env` e preencha apenas as integrações que estiver utilizando. Em produção, o startup aplica as migrações automaticamente quando `DATABASE_URL` estiver definida.

## Segurança planejada

As demandas serão executadas em branches isoladas e containers descartáveis. Alterações só poderão chegar à branch principal por Pull Request, após build, testes automatizados e lint.
