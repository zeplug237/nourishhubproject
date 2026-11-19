import 'dotenv/config';
import { prisma } from './db.js';
import { hashPassword } from './security.js';

const email = (process.env.SEED_ADMIN_EMAIL || 'admin@nourishhub.cm').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || password.length < 16 || /REPLACE_WITH|CHANGE_THIS/i.test(password)) {
  throw new Error('Set a unique SEED_ADMIN_PASSWORD of at least 16 characters in .env before seeding.');
}

try {
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      full_name: 'NOURISH HUB Administrator', email,
      password_hash: await hashPassword(password), role: 'ADMIN', email_verified: true,
    },
  });
  console.log(`Administrator ready: ${email}`);

  for (const name of ['Beverages', 'Snacks & confectionery', 'Groceries', 'Household', 'Personal care', 'Other']) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  if (await prisma.product.count() === 0) {
    const beverages = await prisma.category.findUnique({ where: { name: 'Beverages' } });
    const supplier = await prisma.supplier.create({ data: {
      name: 'Nourish Supply Partners', contact_person: 'Store Supply Desk',
      phone: '+237 600 000 000', address: 'Cameroon',
    }});
    const samples = [
      ['NH-BEV-001', 'Natural fruit juice', beverages.id, 'bottle', 450, 700, 36],
      ['NH-BEV-002', 'Bottled water 1.5L', beverages.id, 'bottle', 250, 400, 8],
      ['NH-SNK-001', 'Butter cookies', null, 'pack', 600, 950, 18],
    ];
    for (const [sku, name, category_id, unit, cost, price, qty] of samples) {
      const product = await prisma.product.create({ data: {
        sku, name, category_id: category_id == null ? null : BigInt(category_id), unit, purchase_price: cost, selling_price: price,
        stock_quantity: qty, low_stock_threshold: 10, supplier_id: supplier.id,
      }});
      await prisma.stockMovement.create({ data: {
        product_id: product.id, movement_type: 'OPENING', quantity_change: qty,
        previous_quantity: 0, new_quantity: qty, note: 'Demo opening balance', performed_by: admin.id,
      }});
    }
  }
  console.log('Seed complete. Change the initial administrator password after first login.');
} finally {
  await prisma.$disconnect();
}
