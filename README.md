# Support Desk CRM

A modular-monolith learning project modeled after internal support and CRM tools. It includes a React frontend, Express API, Prisma/PostgreSQL schema, background worker, domain package, tests, and learning-oriented architecture documentation.

## Local Development

```bash
npm install
cp .env.example .env
docker compose up -d
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Frontend: http://localhost:5173  
API health: http://localhost:4000/api/health

## Learning Path

Start with `docs/architecture/architecture-plan.md`, then read `docs/architecture/architecture-journal.md`. After the initial build, use `docs/walkthrough/important-files.md` to learn how the main files fit together.

For the CRUD repair walkthrough, continue with [`astraupskill/README.md`](astraupskill/README.md). It traces tenant scope, operational ticket authorization, role-aware comment visibility, Prisma transactions, and the staged verification evidence.
