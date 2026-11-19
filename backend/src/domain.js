import { randomUUID } from 'node:crypto';

export const ref = (prefix) => `${prefix}-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const jsonSafe = (value) => JSON.parse(JSON.stringify(value, (_key, v) => {
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return v;
}));

export async function audit(tx, userId, action, entityType, entityId, beforeData = null, afterData = null, ip = null) {
  await tx.auditLog.create({ data: {
    user_id: userId == null ? null : BigInt(userId), action, entity_type: entityType,
    entity_id: entityId == null ? null : BigInt(entityId),
    before_data: beforeData == null ? undefined : jsonSafe(beforeData),
    after_data: afterData == null ? undefined : jsonSafe(afterData), ip_address: ip || null,
  }});
}

export async function notifyManagers(tx, productId, type, priority, title, message, metadata = {}) {
  const managers = await tx.user.findMany({
    where: { role: { in: ['ADMIN', 'MANAGER'] }, is_active: true }, select: { id: true },
  });
  if (!managers.length) return;
  await tx.notification.createMany({ data: managers.map(({ id }) => ({
    recipient_id: id, product_id: productId == null ? null : BigInt(productId),
    notification_type: type, priority, title, message, metadata: jsonSafe(metadata),
  })) });
}

export async function evaluateStock(tx, product, _userId, oldQty, newQty) {
  const threshold = Number(product.low_stock_threshold);
  if (oldQty > threshold && newQty <= threshold && newQty > 0) {
    await notifyManagers(tx, product.id, 'LOW_STOCK', 'WARNING', 'Low stock warning',
      `${product.name} has reached ${newQty} ${product.unit || 'units'} (threshold: ${threshold}).`,
      { sku: product.sku, quantity: newQty, threshold });
  }
  if (oldQty > 0 && newQty === 0) {
    await notifyManagers(tx, product.id, 'OUT_OF_STOCK', 'CRITICAL', 'Product out of stock',
      `${product.name} is now out of stock. Sales are blocked until replenishment.`,
      { sku: product.sku, quantity: 0 });
  }
}
