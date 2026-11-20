# NOURISH HUB Backend API

This folder contains the Express API, Prisma schema and migrations, database seed script, and backend configuration.

## Requirements
- Node.js 20+
- PostgreSQL 14+

## Setup (Windows / VS Code)

1. Start PostgreSQL and create a database named `nourish_hub` (or run `docker compose up -d` in this folder).
2. In this folder, copy `.env.example` to the exact filename `.env` and set `DATABASE_URL` and a private `JWT_SECRET` (at least 32 characters). The app loads `.env`; files such as `.env.ev` are not loaded automatically.
3. Set `APP_ORIGIN` to the frontend origin. With VS Code Live Server this is commonly `http://127.0.0.1:5500` or `http://localhost:5500`.
4. Run:

```powershell
npm.cmd install
npm.cmd run db:init
npm.cmd run db:seed
npm.cmd start
```

The API runs at `http://localhost:3000`. Check `http://localhost:3000/api/health`.

The front page lets applicants request the Cashier, Manager, Storekeeper, Inventory officer, Accountant, or Audit team lead role. Registration creates an inactive account request. An administrator reviews and approves requests under **Team access**; users cannot sign in before approval. No email verification is required. Each role has separate API permissions.

## Prisma commands

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate -- --name describe_your_change
npm.cmd run db:init
npm.cmd run db:seed
```

Keep `.env` private. Back up an existing database before applying migrations.
