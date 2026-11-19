# Prisma + PostgreSQL setup notes

1. Start PostgreSQL and create the `nourish_hub` database, or run `docker compose up -d` from the backend folder.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` for your PostgreSQL host, port, username and password.
3. Set a unique, private `SEED_ADMIN_PASSWORD` in `.env` before seeding.
4. Run `npm.cmd install` to install Prisma CLI and Prisma Client. The postinstall hook generates the client.
5. Run `npm.cmd run db:init` to apply the checked-in migration.
6. Run `npm.cmd run db:seed` to create the initial administrator and starter catalogue.
7. Run `npm.cmd start` and open `http://localhost:3000`.

Prisma is the ORM/data-access layer. PostgreSQL remains the relational database. Do not expose `DATABASE_URL` or `.env` to browser code or commit it to source control.

The server uses Prisma Client model operations for normal CRUD and reporting. Parameterized raw SQL is limited to `SELECT ... FOR UPDATE` statements inside Prisma interactive transactions to lock inventory rows while processing receipts and sales safely.
