# Architecture and data model

## Three-tier architecture

```mermaid
flowchart TB
  U[Administrator / Manager / Storekeeper / Cashier]
  subgraph P[Presentation tier]
    UI[Responsive NOURISH HUB web application]
  end
  subgraph A[Application tier]
    API[Express REST API]
    AUTH[JWT authentication + role authorization]
    INV[Inventory and stock rules]
    POS[Sales and checkout service]
    NOTIFY[Persistent notification service]
    REPORT[Reporting and audit services]
  end
  subgraph D[Data tier]
    ORM[Prisma Client / Prisma ORM]
    DB[(PostgreSQL)]
  end
  U --> UI --> API
  API --> AUTH
  API --> INV
  API --> POS
  API --> NOTIFY
  API --> REPORT
  AUTH --> ORM
  INV --> ORM
  POS --> ORM
  NOTIFY --> ORM
  REPORT --> ORM
  ORM --> DB
  ```

## Transaction guarantees

**Stock receipt:** lock product row → calculate new balance → update product → insert receipt → insert stock movement → persist manager notifications → evaluate threshold → write audit entry → commit. Any failure rolls back all steps.

**Sale:** sort unique product IDs → lock product rows in deterministic order → validate every requested quantity → calculate totals and payment → insert sale → deduct each product → insert sale items and movement records → evaluate stock alerts → audit → commit. Insufficient stock rejects the entire sale. InnoDB row locks prevent concurrent cashiers from overselling the same stock.

## Entity relationship overview

```mermaid
erDiagram
  USERS ||--o{ SALES : processes
  USERS ||--o{ STOCK_ENTRIES : records
  USERS ||--o{ STOCK_MOVEMENTS : performs
  USERS ||--o{ AUDIT_LOGS : creates
  USERS ||--o{ NOTIFICATIONS : receives
  CATEGORIES ||--o{ PRODUCTS : groups
  SUPPLIERS ||--o{ PRODUCTS : preferred_supplier
  SUPPLIERS ||--o{ STOCK_ENTRIES : supplies
  PRODUCTS ||--o{ STOCK_ENTRIES : replenished_by
  PRODUCTS ||--o{ SALE_ITEMS : sold_as
  PRODUCTS ||--o{ STOCK_MOVEMENTS : changes
  PRODUCTS ||--o{ NOTIFICATIONS : triggers
  SALES ||--|{ SALE_ITEMS : contains
```

Prisma Client is the normal data-access API; raw SQL is used only to acquire explicit InnoDB row locks inside Prisma transactions. The product row holds the current balance for fast lookup; `stock_movements` is the append-only operational ledger. Corrections should be represented as adjustments, not silent edits to historical movement records.
