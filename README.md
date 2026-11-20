# NOURISH HUB — Store Management System (Separated Frontend + Backend)

A responsive store-management platform for NOURISH HUB. The application is now organized into two independent folders:

```text
NOURISH_HUB_Store_Management_System/
├── frontend/                 # Browser UI: HTML, CSS, JavaScript
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── config.js              # Backend API URL
│   └── README.md
├── backend/                  # Express API + Prisma + database migrations
│   ├── src/
│   ├── prisma/
│   ├── docs/
│   ├── package.json
│   ├── .env.example
│   ├── docker-compose.yml
│   └── README.md
└── README.md
```

## 1. Backend setup

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Start PostgreSQL and create a database named `nourish_hub` (or use `docker compose up -d` from `backend`).
2. Open the `backend` folder in a terminal.
3. Copy the environment template and configure it:

```powershell
cd backend
Copy-Item .env.example .env
```

Set `DATABASE_URL` to your PostgreSQL connection. For the provided Docker Compose service:

```env
DATABASE_URL="postgresql://nourish_app:change-this-password@127.0.0.1:5432/nourish_hub?schema=public"
```

Generate a strong JWT secret and place it in `backend/.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `APP_ORIGIN` to the frontend's local origin. VS Code Live Server commonly uses `http://127.0.0.1:5500` (or `http://localhost:5500`).

Install and initialize:

```powershell
npm.cmd install
npm.cmd run db:init
npm.cmd run db:seed
npm.cmd start
```

The API is available at `http://localhost:3000`; health check: `http://localhost:3000/api/health`.

## 2. Frontend setup

1. Open the `frontend` folder in VS Code.
2. Open `index.html` using the Live Server extension (or any static web server).
3. The frontend calls `http://localhost:3000/api` by default. Change `frontend/config.js` if your API is hosted elsewhere:

```js
window.NOURISH_API_BASE = 'https://your-api-domain.example/api';
```

For deployment, configure the backend `APP_ORIGIN` to the exact frontend website origin. Do not use `*` for production CORS when credentials are enabled.

## 3. Default development account

- Email: `admin@nourishhub.cm`
- Password: the value of `SEED_ADMIN_PASSWORD` in `backend/.env`

The initial password is generated privately during setup. Change it after first login. For a fresh setup, replace the placeholder `SEED_ADMIN_PASSWORD` in `backend/.env` with a unique random value before running the seed script.

## 4. Technology

- Frontend: HTML5, CSS3, vanilla JavaScript
- Backend: Node.js 20+, Express 5, JWT authentication, Zod validation
- ORM: Prisma 6 + Prisma Client
- Database: PostgreSQL

Prisma is the ORM/data-access layer and PostgreSQL is the database server.

## 5. Main capabilities

- Role-based access: Administrator, Store Manager, Storekeeper and Cashier
- Inventory and product catalogue
- Stock receiving and stock movement ledger
- Point of sale and transaction-safe stock deduction
- Low-stock and out-of-stock notifications
- Sales history, reports and CSV export
- Audit trail and user management

See `backend/docs/` for architecture, deployment checklist, user guide, requirements traceability and Prisma setup notes.
