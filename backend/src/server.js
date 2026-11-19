import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { prisma, withTransaction } from './db.js';
import { authenticate, allow, verifyPassword, hashPassword, signToken } from './security.js';
import { audit, notifyManagers, evaluateStock, ref, money } from './domain.js';

const app = express();
const frontendDirectory = fileURLToPath(new URL('../../frontend/', import.meta.url));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_ORIGIN || true, credentials: true }));
app.use(compression());
// Serve the browser app from the same origin as the API for a one-command local run.
app.use(express.static(frontendDirectory, { index: 'index.html' }));
app.use(express.json({ limit: '1mb' }));
// Prisma Decimal instances are converted to ordinary JSON numbers for the existing browser UI.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(JSON.parse(JSON.stringify(body, (_key, value) => {
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value.toNumber === 'function') return value.toNumber();
    return value;
  })));
  next();
});
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many account requests. Please wait and try again later.' }),
}));
app.use('/api/auth/verify-email', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/resend-code', rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const positiveInt = z.number().int().positive();
const productSchema = z.object({
  sku: z.string().trim().min(2).max(70), name: z.string().trim().min(2).max(160),
  category_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().max(3000).optional().default(''), unit: z.string().max(30).optional().default('unit'),
  purchase_price: z.coerce.number().min(0), selling_price: z.coerce.number().min(0),
  low_stock_threshold: z.coerce.number().int().min(0).default(10),
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
});
const dayStart = (value) => { const d = new Date(`${value}T00:00:00`); if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Invalid date filter'), { status: 400 }); return d; };
const dayAfter = (value) => { const d = dayStart(value); d.setDate(d.getDate() + 1); return d; };
const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const verificationHash = (code) => createHmac('sha256', process.env.JWT_SECRET || '').update(code).digest('hex');
async function sendVerificationCode(email, fullName, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw Object.assign(new Error('Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM in backend/.env.'), { status: 503 });
  const safeName = String(fullName).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email], subject: 'Your NOURISH HUB verification code',
        text: `Hello ${fullName}, your NOURISH HUB verification code is ${code}. It expires in 15 minutes.`,
        html: `<p>Hello ${safeName},</p><p>Your NOURISH HUB verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 15 minutes. If you did not request it, ignore this email.</p>`,
      }),
    });
  } catch {
    throw Object.assign(new Error('Could not connect to the email service. Please try again.'), { status: 502 });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || 'The email service could not send the verification code.'), { status: 502 });
  }
}
const mapProduct = (p, cashier = false) => {
  const result = {
    ...p,
    purchase_price: Number(p.purchase_price), selling_price: Number(p.selling_price),
    category: p.category?.name ?? null, supplier: p.supplier?.name ?? null,
  };
  if (cashier) delete result.purchase_price;
  delete result.category;
  delete result.supplier;
  result.category = p.category?.name ?? null;
  result.supplier = p.supplier?.name ?? null;
  return result;
};

app.get('/api/health', asyncRoute(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', service: 'NOURISH HUB Store API', database: 'connected', orm: 'Prisma' });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !await verifyPassword(parsed.data.password, user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password' });
  if (!user.email_verified) return res.status(403).json({ error: 'Verify your email with the code we sent before signing in.' });
  if (!user.is_active) return res.status(403).json({ error: 'Your email is verified. An administrator must activate your requested role before you can sign in.' });
  await prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const parsed = z.object({
    full_name: z.string().trim().min(2).max(140),
    email: z.string().trim().email().max(190),
    password: z.string().min(10).max(128),
    role: z.enum(['ACCOUNTANT', 'AUDIT_TEAM_LEAD', 'INVENTORY_OFFICER']),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your name, email, password, and requested role.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return res.status(503).json({ error: 'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM in backend/.env.' });
  const { full_name, password, role } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.email_verified) return res.status(409).json({ error: 'This email is already registered. Sign in or ask an administrator to activate the account.' });
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  try {
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: {
        full_name, password_hash: await hashPassword(password), role, is_active: false,
        email_verified: false, verification_code_hash: verificationHash(code),
        verification_expires_at: expires, verification_attempts: 0,
      }});
    } else {
      await prisma.user.create({ data: {
        full_name, email, password_hash: await hashPassword(password), role, is_active: false,
        email_verified: false, verification_code_hash: verificationHash(code),
        verification_expires_at: expires, verification_attempts: 0,
      }});
    }
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'This email is already registered. Sign in or ask an administrator to activate the account.' });
    throw error;
  }
  await sendVerificationCode(email, full_name, code);
  res.status(existing ? 200 : 201).json({ message: 'Verification code sent. Check your email and enter the six-digit code to verify your address.' });
}));

app.post('/api/auth/verify-email', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(190), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and six-digit verification code.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || user.email_verified || !user.verification_code_hash) return res.status(400).json({ error: 'This verification code is invalid or expired. Request a new code.' });
  if (user.verification_attempts >= 5) return res.status(429).json({ error: 'Too many incorrect codes. Request a new verification code.' });
  if (!user.verification_expires_at || user.verification_expires_at <= new Date()) return res.status(400).json({ error: 'This verification code has expired. Request a new code.' });
  const actual = Buffer.from(verificationHash(parsed.data.code));
  const expected = Buffer.from(user.verification_code_hash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    await prisma.user.update({ where: { id: user.id }, data: { verification_attempts: { increment: 1 } } });
    return res.status(400).json({ error: 'That code is incorrect. Check the email and try again.' });
  }
  await prisma.user.update({ where: { id: user.id }, data: {
    email_verified: true, verification_code_hash: null, verification_expires_at: null, verification_attempts: 0,
  }});
  res.json({ message: 'Email verified. An administrator must activate your requested role before you can sign in.' });
}));

app.post('/api/auth/resend-code', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(190) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return res.status(503).json({ error: 'Email verification is not configured on the server.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || user.email_verified) return res.json({ message: 'If the account needs verification, a new code has been sent.' });
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  await prisma.user.update({ where: { id: user.id }, data: {
    verification_code_hash: verificationHash(code), verification_expires_at: new Date(Date.now() + 15 * 60 * 1000), verification_attempts: 0,
  }});
  await sendVerificationCode(user.email, user.full_name, code);
  res.json({ message: 'A new verification code has been sent.' });
}));

app.post('/api/auth/change-password', authenticate, asyncRoute(async (req, res) => {
  const p = z.object({ current_password: z.string(), new_password: z.string().min(10) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: BigInt(req.user.sub) } });
  if (!user || !await verifyPassword(p.current_password, user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  await prisma.user.update({ where: { id: user.id }, data: { password_hash: await hashPassword(p.new_password) } });
  res.json({ message: 'Password updated' });
}));

app.use('/api', authenticate);
app.get('/api/me', (req, res) => res.json({ user: { id: req.user.sub, name: req.user.name, email: req.user.email, role: req.user.role } }));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const now = new Date(); const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const products = await prisma.product.findMany({ where: { is_active: true }, select: { stock_quantity: true, low_stock_threshold: true, purchase_price: true } });
  const inventory = {
    products: products.length,
    units: products.reduce((sum, p) => sum + p.stock_quantity, 0),
    low_stock: products.filter(p => p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold).length,
    out_stock: products.filter(p => p.stock_quantity === 0).length,
    inventory_value: products.reduce((sum, p) => sum + p.stock_quantity * Number(p.purchase_price), 0),
  };
  const todaysSales = await prisma.sale.findMany({ where: { status: 'COMPLETED', created_at: { gte: today, lt: tomorrow } }, select: { total_amount: true, discount: true } });
  const sales = {
    transactions: todaysSales.length,
    revenue: todaysSales.reduce((sum, s) => sum + Number(s.total_amount), 0),
    discounts: todaysSales.reduce((sum, s) => sum + Number(s.discount), 0),
  };
  const unread_notifications = await prisma.notification.count({ where: { recipient_id: BigInt(req.user.sub), is_read: false } });
  const recentRows = await prisma.sale.findMany({ where: { status: 'COMPLETED' }, include: { cashier: { select: { full_name: true } } }, orderBy: { created_at: 'desc' }, take: 6 });
  const recent = recentRows.map(s => ({ id: s.id, sale_no: s.sale_no, total_amount: Number(s.total_amount), payment_method: s.payment_method, created_at: s.created_at, cashier: s.cashier.full_name }));
  const alertRows = await prisma.product.findMany({ where: { is_active: true, stock_quantity: { lte: 1000000 } }, orderBy: [{ stock_quantity: 'asc' }, { name: 'asc' }] });
  const alerts = alertRows.filter(p => p.stock_quantity <= p.low_stock_threshold).slice(0, 8).map(p => ({ id: p.id, sku: p.sku, name: p.name, stock_quantity: p.stock_quantity, low_stock_threshold: p.low_stock_threshold, status: p.stock_quantity === 0 ? 'OUT OF STOCK' : 'LOW STOCK' }));
  const chartStart = new Date(today); chartStart.setDate(chartStart.getDate() - 6);
  const chartSales = await prisma.sale.findMany({ where: { status: 'COMPLETED', created_at: { gte: chartStart, lt: tomorrow } }, select: { created_at: true, total_amount: true }, orderBy: { created_at: 'asc' } });
  const chartMap = new Map();
  for (const s of chartSales) { const key = dateKey(s.created_at); const item = chartMap.get(key) || { day: new Date(`${key}T00:00:00`).toLocaleDateString('en', { weekday: 'short' }), sale_date: key, revenue: 0 }; item.revenue += Number(s.total_amount); chartMap.set(key, item); }
  res.json({ inventory, sales, unread_notifications, recent, alerts, chart: [...chartMap.values()] });
}));

app.get('/api/products', asyncRoute(async (req, res) => {
  const search = String(req.query.search || '').trim(); const status = String(req.query.status || 'ALL').toUpperCase();
  const where = { is_active: true };
  if (search) where.OR = [{ name: { contains: search } }, { sku: { contains: search } }];
  if (status === 'LOW') where.AND = [{ stock_quantity: { gt: 0 } }, { stock_quantity: { lte: 1000000 } }];
  const rows = await prisma.product.findMany({ where, include: { category: { select: { name: true } }, supplier: { select: { name: true } } }, orderBy: { name: 'asc' } });
  const filtered = rows.filter(p => status === 'ALL' || (status === 'LOW' && p.stock_quantity <= p.low_stock_threshold && p.stock_quantity > 0) || (status === 'OUT' && p.stock_quantity === 0) || (status === 'IN' && p.stock_quantity > p.low_stock_threshold));
  res.json(filtered.map(p => mapProduct(p, req.user.role === 'CASHIER')));
}));

app.post('/api/products', allow('ADMIN', 'MANAGER', 'STOREKEEPER', 'INVENTORY_OFFICER'), asyncRoute(async (req, res) => {
  const d = productSchema.parse(req.body);
  const created = await withTransaction(async tx => {
    const product = await tx.product.create({ data: {
      sku: d.sku, name: d.name, category_id: d.category_id == null ? null : BigInt(d.category_id), description: d.description,
      unit: d.unit, purchase_price: d.purchase_price, selling_price: d.selling_price,
      low_stock_threshold: d.low_stock_threshold, supplier_id: d.supplier_id == null ? null : BigInt(d.supplier_id),
    }});
    await audit(tx, BigInt(req.user.sub), 'PRODUCT_CREATED', 'PRODUCT', product.id, null, d, req.ip);
    return product;
  });
  res.status(201).json({ id: created.id, message: 'Product created' });
}));

app.put('/api/products/:id', allow('ADMIN', 'MANAGER', 'STOREKEEPER', 'INVENTORY_OFFICER'), asyncRoute(async (req, res) => {
  const id = BigInt(req.params.id); const d = productSchema.partial().parse(req.body);
  const old = await prisma.product.findFirst({ where: { id, is_active: true } });
  if (!old) return res.status(404).json({ error: 'Product not found' });
  const data = {};
  for (const [key, value] of Object.entries(d)) if (value !== undefined) data[key] = (key === 'category_id' || key === 'supplier_id') ? (value == null ? null : BigInt(value)) : value;
  const updated = await withTransaction(async tx => {
    const p = await tx.product.update({ where: { id }, data });
    await audit(tx, BigInt(req.user.sub), 'PRODUCT_UPDATED', 'PRODUCT', id, old, p, req.ip);
    return p;
  });
  res.json({ message: 'Product updated' });
}));
app.delete('/api/products/:id', allow('ADMIN', 'MANAGER'), asyncRoute(async (req, res) => {
  await prisma.product.update({ where: { id: BigInt(req.params.id) }, data: { is_active: false } });
  res.json({ message: 'Product archived' });
}));

app.get('/api/categories', asyncRoute(async (_req, res) => res.json(await prisma.category.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/categories', allow('ADMIN', 'MANAGER'), asyncRoute(async (req, res) => {
  const d = z.object({ name: z.string().trim().min(2).max(100), description: z.string().max(255).optional() }).parse(req.body);
  const item = await prisma.category.create({ data: { name: d.name, description: d.description || null } });
  res.status(201).json({ id: item.id });
}));
app.get('/api/suppliers', asyncRoute(async (_req, res) => res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/suppliers', allow('ADMIN', 'MANAGER', 'STOREKEEPER', 'INVENTORY_OFFICER'), asyncRoute(async (req, res) => {
  const d = z.object({ name: z.string().min(2).max(150), contact_person: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal('')), address: z.string().optional(), notes: z.string().optional() }).parse(req.body);
  const item = await prisma.supplier.create({ data: { name: d.name, contact_person: d.contact_person || null, phone: d.phone || null, email: d.email || null, address: d.address || null, notes: d.notes || null } });
  res.status(201).json({ id: item.id });
}));

app.post('/api/stock/receipts', allow('ADMIN', 'MANAGER', 'STOREKEEPER', 'INVENTORY_OFFICER'), asyncRoute(async (req, res) => {
  const d = z.object({ product_id: positiveInt, quantity: positiveInt, supplier_id: z.coerce.number().int().positive().nullable().optional(), arrival_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), unit_cost: z.coerce.number().min(0).optional().default(0), notes: z.string().max(1000).optional() }).parse(req.body);
  const result = await withTransaction(async tx => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${BigInt(d.product_id)} AND is_active = TRUE FOR UPDATE`;
    const p = await tx.product.findFirst({ where: { id: BigInt(d.product_id), is_active: true } });
    if (!p) throw Object.assign(new Error('Product not found'), { status: 404 });
    const old = p.stock_quantity; const next = old + d.quantity; const unitCost = d.unit_cost || Number(p.purchase_price);
    await tx.product.update({ where: { id: p.id }, data: { stock_quantity: next, purchase_price: unitCost } });
    const receiptNo = ref('RCV');
    const receipt = await tx.stockEntry.create({ data: {
      receipt_no: receiptNo, product_id: p.id, supplier_id: d.supplier_id == null ? p.supplier_id : BigInt(d.supplier_id),
      quantity_received: d.quantity, previous_quantity: old, new_quantity: next, unit_cost: unitCost,
      arrival_date: new Date(`${d.arrival_date}T00:00:00.000Z`), recorded_by: BigInt(req.user.sub), notes: d.notes || null,
    }});
    await tx.stockMovement.create({ data: { product_id: p.id, movement_type: 'RECEIPT', quantity_change: d.quantity, previous_quantity: old, new_quantity: next, reference_type: 'STOCK_RECEIPT', reference_id: receipt.id, note: d.notes || 'Stock received', performed_by: BigInt(req.user.sub) } });
    await notifyManagers(tx, p.id, 'NEW_STOCK', 'INFO', 'New stock received', `${d.quantity} ${p.unit} of ${p.name} received. Balance: ${old} → ${next}.`, { receipt_no: receiptNo, quantity: d.quantity, previous: old, current: next, supplier_id: d.supplier_id == null ? p.supplier_id : BigInt(d.supplier_id), arrival_date: d.arrival_date, recorded_by: req.user.name });
    await evaluateStock(tx, p, req.user.sub, old, next);
    await audit(tx, BigInt(req.user.sub), 'STOCK_RECEIVED', 'STOCK_RECEIPT', receipt.id, { quantity: old }, { quantity: next, receipt_no: receiptNo }, req.ip);
    return { receipt_no: receiptNo, previous: old, current: next };
  });
  res.status(201).json({ ...result, message: 'Stock receipt recorded and manager notified' });
}));

app.post('/api/sales', allow('ADMIN', 'MANAGER', 'CASHIER'), asyncRoute(async (req, res) => {
  const d = z.object({ items: z.array(z.object({ product_id: positiveInt, quantity: positiveInt })).min(1), discount: z.coerce.number().min(0).default(0), payment_method: z.enum(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER']).default('CASH'), amount_paid: z.coerce.number().min(0) }).parse(req.body);
  const result = await withTransaction(async tx => {
    // Merge duplicate cart lines, then lock product rows in ascending ID order to avoid deadlocks.
    const quantities = new Map();
    for (const item of d.items) { const key = BigInt(item.product_id); quantities.set(key, (quantities.get(key) || 0) + item.quantity); }
    const ids = [...quantities.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    for (const id of ids) await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} AND is_active = TRUE FOR UPDATE`;
    const products = await tx.product.findMany({ where: { id: { in: ids }, is_active: true } });
    const byId = new Map(products.map(p => [p.id, p]));
    for (const id of ids) if (!byId.has(id)) throw Object.assign(new Error(`Product ${id} was not found`), { status: 404 });
    let subtotal = 0; const lines = [];
    for (const id of ids) {
      const p = byId.get(id); const quantity = quantities.get(id);
      if (p.stock_quantity < quantity) throw Object.assign(new Error(`Insufficient stock for ${p.name}. Available: ${p.stock_quantity}`), { status: 409 });
      const line = money(Number(p.selling_price) * quantity); subtotal += line; lines.push({ p, quantity, line });
    }
    subtotal = money(subtotal);
    if (d.discount > subtotal) throw Object.assign(new Error('Discount cannot exceed subtotal'), { status: 400 });
    const total = money(subtotal - d.discount);
    if (d.amount_paid < total) throw Object.assign(new Error('Amount paid is less than the sale total'), { status: 400 });
    const saleNo = ref('NH');
    const sale = await tx.sale.create({ data: { sale_no: saleNo, cashier_id: BigInt(req.user.sub), subtotal, discount: d.discount, total_amount: total, payment_method: d.payment_method, amount_paid: d.amount_paid, change_due: money(d.amount_paid - total) } });
    for (const line of lines) {
      const { p, quantity } = line; const old = p.stock_quantity; const next = old - quantity;
      await tx.product.update({ where: { id: p.id }, data: { stock_quantity: next } });
      await tx.saleItem.create({ data: { sale_id: sale.id, product_id: p.id, product_name: p.name, sku: p.sku, quantity_sold: quantity, unit_price: p.selling_price, unit_cost: p.purchase_price, subtotal: line.line } });
      await tx.stockMovement.create({ data: { product_id: p.id, movement_type: 'SALE', quantity_change: -quantity, previous_quantity: old, new_quantity: next, reference_type: 'SALE', reference_id: sale.id, note: `Sale ${saleNo}`, performed_by: BigInt(req.user.sub) } });
      await evaluateStock(tx, p, req.user.sub, old, next);
    }
    await audit(tx, BigInt(req.user.sub), 'SALE_COMPLETED', 'SALE', sale.id, null, { sale_no: saleNo, total, items: lines.length }, req.ip);
    return { sale_no: saleNo, total, subtotal, discount: d.discount, change_due: money(d.amount_paid - total), items: lines.map(x => ({ name: x.p.name, quantity: x.quantity, unit_price: Number(x.p.selling_price), subtotal: x.line })) };
  });
  res.status(201).json({ ...result, message: 'Sale completed successfully' });
}));

app.get('/api/sales', asyncRoute(async (req, res) => {
  const from = String(req.query.from || dateKey(new Date(Date.now() - 30 * 86400000)));
  const to = String(req.query.to || dateKey(new Date()));
  const rows = await prisma.sale.findMany({ where: { created_at: { gte: dayStart(from), lt: dayAfter(to) } }, include: { cashier: { select: { full_name: true } } }, orderBy: { created_at: 'desc' }, take: 500 });
  res.json(rows.map(s => ({ ...s, cashier: s.cashier.full_name, subtotal: Number(s.subtotal), discount: Number(s.discount), total_amount: Number(s.total_amount), amount_paid: Number(s.amount_paid), change_due: Number(s.change_due) })));
}));
app.get('/api/notifications', asyncRoute(async (req, res) => {
  const rows = await prisma.notification.findMany({ where: { recipient_id: BigInt(req.user.sub) }, include: { product: { select: { name: true, sku: true } } }, orderBy: { created_at: 'desc' }, take: 100 });
  res.json(rows.map(n => ({ ...n, product_name: n.product?.name ?? null, sku: n.product?.sku ?? null, product: undefined })));
}));
app.patch('/api/notifications/:id/read', asyncRoute(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: BigInt(req.params.id), recipient_id: BigInt(req.user.sub) }, data: { is_read: true } });
  res.json({ message: 'Notification marked as read' });
}));
app.patch('/api/notifications/read-all', asyncRoute(async (req, res) => {
  await prisma.notification.updateMany({ where: { recipient_id: BigInt(req.user.sub) }, data: { is_read: true } });
  res.json({ message: 'All notifications marked as read' });
}));
app.get('/api/movements', asyncRoute(async (_req, res) => {
  const rows = await prisma.stockMovement.findMany({ include: { product: { select: { name: true, sku: true } }, performer: { select: { full_name: true } } }, orderBy: { created_at: 'desc' }, take: 300 });
  res.json(rows.map(m => ({ ...m, product_name: m.product.name, sku: m.product.sku, performed_by_name: m.performer.full_name, product: undefined, performer: undefined })));
}));

app.get('/api/reports/summary', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const from = String(req.query.from || dateKey(new Date(Date.now() - 29 * 86400000)));
  const to = String(req.query.to || dateKey(new Date())); const start = dayStart(from); const end = dayAfter(to);
  const sales = await prisma.sale.findMany({ where: { status: 'COMPLETED', created_at: { gte: start, lt: end } }, include: { sale_items: true } });
  const totals = { transactions: sales.length, revenue: sales.reduce((s, x) => s + Number(x.total_amount), 0), discounts: sales.reduce((s, x) => s + Number(x.discount), 0) };
  const dailyMap = new Map(); const topMap = new Map();
  for (const sale of sales) {
    const key = dateKey(sale.created_at); const day = dailyMap.get(key) || { day: key, transactions: 0, revenue: 0 };
    day.transactions += 1; day.revenue += Number(sale.total_amount); dailyMap.set(key, day);
    for (const item of sale.sale_items) { const top = topMap.get(item.product_id) || { product_name: item.product_name, units: 0, revenue: 0 }; top.units += item.quantity_sold; top.revenue += Number(item.subtotal); topMap.set(item.product_id, top); }
  }
  const receiptRows = await prisma.stockEntry.findMany({ where: { recorded_at: { gte: start, lt: end } }, select: { quantity_received: true } });
  const receipts = { receipts: receiptRows.length, units_received: receiptRows.reduce((s, r) => s + r.quantity_received, 0) };
  const top = [...topMap.values()].sort((a, b) => b.units - a.units).slice(0, 10);
  res.json({ from, to, totals, daily: [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day)), top, receipts });
}));
app.get('/api/reports/sales.csv', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const from = String(req.query.from || '2000-01-01'); const to = String(req.query.to || '2099-12-31');
  const rows = await prisma.sale.findMany({ where: { created_at: { gte: dayStart(from), lt: dayAfter(to) } }, include: { cashier: { select: { full_name: true } } }, orderBy: { created_at: 'desc' } });
  const q = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = ['Sale No,Date,Cashier,Payment,Subtotal,Discount,Total,Paid,Change', ...rows.map(r => [r.sale_no, r.created_at, r.cashier.full_name, r.payment_method, r.subtotal, r.discount, r.total_amount, r.amount_paid, r.change_due].map(q).join(','))].join('\n');
  res.type('text/csv').attachment('nourish-hub-sales-report.csv').send(csv);
}));
app.get('/api/users', allow('ADMIN', 'MANAGER'), asyncRoute(async (_req, res) => {
  const rows = await prisma.user.findMany({ select: { id: true, full_name: true, email: true, role: true, is_active: true, email_verified: true, last_login_at: true, created_at: true }, orderBy: { full_name: 'asc' } });
  res.json(rows);
}));
app.post('/api/users', allow('ADMIN'), asyncRoute(async (req, res) => {
  const parsed = z.object({ full_name: z.string().trim().min(2).max(140), email: z.string().trim().email(), password: z.string().min(10).max(128), role: z.enum(['ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER', 'ACCOUNTANT', 'AUDIT_TEAM_LEAD', 'INVENTORY_OFFICER']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a name, valid email, password of at least 10 characters, and a valid role.' });
  const d = parsed.data;
  const user = await prisma.user.create({ data: { full_name: d.full_name, email: d.email.toLowerCase(), password_hash: await hashPassword(d.password), role: d.role, email_verified: true } });
  res.status(201).json({ id: user.id, message: 'User created' });
}));
app.patch('/api/users/:id/status', allow('ADMIN'), asyncRoute(async (req, res) => {
  const active = z.boolean().parse(req.body.is_active); const id = BigInt(req.params.id);
  if (BigInt(req.user.sub) === id && !active) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  const target = await prisma.user.findUnique({ where: { id }, select: { email_verified: true } });
  if (!target) return res.status(404).json({ error: 'The requested record was not found' });
  if (active && !target.email_verified) return res.status(400).json({ error: 'The user must verify their email before activation.' });
  await prisma.user.update({ where: { id }, data: { is_active: active } });
  res.json({ message: 'User status updated' });
}));
app.get('/api/audit', allow('ADMIN', 'MANAGER', 'AUDIT_TEAM_LEAD'), asyncRoute(async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ include: { user: { select: { full_name: true } } }, orderBy: { created_at: 'desc' }, take: 250 });
  res.json(rows.map(a => ({ ...a, full_name: a.user?.full_name ?? null, user: undefined })));
}));

// Frontend is deployed separately from this API service.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Please check the form fields', details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  if (err.code === 'P2002' || err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with that unique value already exists' });
  if (err.code === 'P2025') return res.status(404).json({ error: 'The requested record was not found' });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred' });
});

export default app;

if (process.env.VERCEL !== '1') {
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`NOURISH HUB Store running at http://localhost:${port}`));
  const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
