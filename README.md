# BitBlockIT CRM – Backend

NestJS API backend for BitBlockIT CRM (Prisma, PostgreSQL, Redis, etc.).

## Setup

```bash
npm install
cp .env.example .env   # then edit .env
npm run prisma:generate
npm run prisma:migrate
```

## Scripts

- `npm run start:dev` – development with watch
- `npm run build` – production build
- `npm run start:prod` – run production build
- `npm run prisma:generate` – generate Prisma client
- `npm run prisma:migrate` – run migrations (dev)
- `npm run prisma:deploy` – deploy migrations (prod)
- `npm run prisma:studio` – open Prisma Studio
- `npm run seed` – run seed script

## Repo history

This repo was split out from the main BitBlockIT-CRM monorepo. The original backend lived at `BitBlockIT-CRM/backend/`.
