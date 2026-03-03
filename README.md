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

## Production / same-server (VM)

When the API and PostgreSQL run on the **same server**, the CRM may show "Database … Disconnected" if `DATABASE_URL` uses the public hostname (e.g. `crmapi.bitblockit.com`). Postgres often listens only on `127.0.0.1`, so the backend must connect via **localhost**.

**On the server:**

1. **Set DATABASE_URL to localhost** in the env used by the backend (e.g. `.env` or systemd):
   ```bash
   DATABASE_URL="postgresql://crm:YOUR_PASSWORD@localhost:5432/bitblockit_crm"
   ```
   Use the same user, password, and database name as before; only change the host to `localhost`.

2. **Confirm Postgres is running and reachable:**
   ```bash
   sudo systemctl status postgresql   # or postgresql@14, etc.
   psql -h localhost -U crm -d bitblockit_crm -c "SELECT 1"
   ```

3. **Restart the backend** so it picks up the new `DATABASE_URL`.

4. In the CRM, open **Admin → System Health**. Database should show "✓ Connected".

## Repo history

This repo was split out from the main BitBlockIT-CRM monorepo. The original backend lived at `BitBlockIT-CRM/backend/`.
