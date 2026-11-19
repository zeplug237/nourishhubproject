# SRS / PDR Implementation Traceability

| Requirement / design point | Implementation |
|---|---|
| FR-01 Authentication and role access | `src/security.js`, `/api/auth/login`, route-level `allow()` middleware |
| FR-02 Product registration | `Product` Prisma model, `/api/products`, product catalogue form |
| FR-03 Stock receiving and separate dates | `/api/stock/receipts`, `StockEntry.arrival_date` and `recorded_at` |
| FR-04 New-stock manager notification | `notifyManagers()` in `src/domain.js`; persistent `notifications` rows |
| FR-05 Sale and automatic deduction | `/api/sales`; transaction, row lock, sale items, movement ledger |
| FR-06 Low-stock alert | `evaluateStock()`; transition from above threshold to at/below threshold; default 10 |
| FR-07 Out-of-stock alert | `evaluateStock()`; transition to zero; sale checks reject insufficient stock |
| FR-08 Manager dashboard | `/api/dashboard`, responsive dashboard cards, chart, alerts and recent sales |
| FR-09 Daily/period reports | `/api/reports/summary`, `/api/reports/sales.csv` |
| FR-10 Movement history and audit | `StockMovement`, `AuditLog` Prisma models, `/api/movements`, `/api/audit` |
| FR-11 Notification center | `/api/notifications`, mark-read endpoints, persistent database storage |
| NFR security | Password hashing, JWT, role checks, validation, Helmet, login rate limiting |
| NFR integrity / atomicity | Prisma interactive transactions, parameterized `SELECT ... FOR UPDATE` row locks, foreign keys, nonnegative stock check |
| NFR responsiveness | CSS responsive breakpoints for desktop, tablet and mobile |
| PDR three-tier architecture | Browser UI → Express API/domain services → Prisma Client → PostgreSQL |
| PDR concurrent sale protection | Product rows locked in stable ID order within one transaction |
| PDR duplicate low-stock episode suppression | Alert only when previous quantity was above threshold; replenishment above threshold resets transition |
| PDR offline manager alert | Notifications stored per manager/admin user in PostgreSQL through Prisma, read on next login |

## Review notes

- The schema stores product balance for fast reads and writes every change to the movement ledger in the same transaction.
- Stock receipt stores actual arrival date separately from the database recording timestamp.
- The initial interface displays XAF and assumes the store's reporting timezone is `Africa/Douala`; deployment should configure timezone and date cut-off explicitly.
- Notifications are in-app only in this release. External messaging requires a configured provider and delivery confirmation.
