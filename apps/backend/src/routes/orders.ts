import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../config/database.js';
import { receiptStorageReady } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { assert } from '../utils/errors.js';
import { jsonValue } from '../utils/serialize.js';
import { activeStatuses, cartSchema, customerOrderJson, orderInclude, quoteCart } from '../services/orders.js';
import { ioEvent } from '../services/realtime.js';
import { phoneSchema } from '../utils/validators.js';
import { paginationSchema, pageMetadata } from '../utils/pagination.js';
import { notificationDto } from '../services/notifications.js';

export const orderRouter = Router();
orderRouter.use(requireAuth);
const orderListQuerySchema = paginationSchema.extend({ scope: z.enum(['all', 'active', 'history']).default('all') });
orderRouter.get('/', async (req, res) => {
  const { page, pageSize, scope } = orderListQuerySchema.parse(req.query);
  const where: Prisma.OrderWhereInput = { userId: req.user!.id, ...(scope === 'active' ? { status: { in: activeStatuses } } : scope === 'history' ? { status: { notIn: activeStatuses } } : {}) };
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    db.order.count({ where }),
  ]);
  res.json({ data: orders.map(customerOrderJson), pagination: pageMetadata(page, pageSize, total) });
});
orderRouter.post('/quote', async (req, res) => { res.json({ data: jsonValue(await quoteCart(cartSchema.parse(req.body))) }); });
orderRouter.get('/:id', async (req, res) => {
  const order = await db.order.findFirst({ where: { id: req.params.id as string, userId: req.user!.id }, include: orderInclude });
  assert(order, 404, 'NOT_FOUND', 'Заказ не найден');
  res.json({ data: customerOrderJson(order) });
});
const createOrderSchema = z.object({
  items: cartSchema.shape.items,
  addressId: z.string().min(1).max(100), recipientName: z.string().trim().min(2).max(80),
  recipientPhone: phoneSchema,
  comment: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(['CASH', 'CARD']), receiptId: z.string().max(100).optional(),
}).strict();
orderRouter.post('/', rateLimit('orders', 20, 900), async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  cartSchema.parse({ items: input.items });
  const userId = req.user!.id;
  const result = await db.$transaction(async tx => {
    assert(!await tx.order.findFirst({ where: { userId, status: { in: activeStatuses } }, select: { id: true } }), 409, 'ACTIVE_ORDER_EXISTS', 'У вас уже есть активный заказ. Дождитесь его завершения');
    const quote = await quoteCart({ items: input.items }, tx);
    const address = await tx.userAddress.findFirst({ where: { id: input.addressId, userId } });
    assert(address, 400, 'ADDRESS_REQUIRED', 'Выберите сохранённый адрес доставки');
    let receiptId: string | undefined;
    if (input.paymentMethod === 'CARD') {
      assert(receiptStorageReady && quote.restaurant.cardPaymentAvailable, 409, 'CARD_UNAVAILABLE', 'Оплата картой для этого ресторана не настроена');
      assert(input.receiptId, 400, 'RECEIPT_REQUIRED', 'Загрузите чек об оплате');
      const receipt = await tx.upload.findFirst({ where: { id: input.receiptId, userId, purpose: 'RECEIPT', payment: null } });
      assert(receipt, 400, 'INVALID_RECEIPT', 'Чек не найден или уже используется');
      receiptId = receipt.id;
    }
    const { userId: _owner, id: _id, createdAt: _created, updatedAt: _updated, ...addressSnapshot } = address;
    const order = await tx.order.create({ data: {
      userId, restaurantId: quote.restaurant.id, restaurantName: quote.restaurant.name, restaurantAddress: quote.restaurant.addressText,
      addressSnapshot: { ...addressSnapshot, ...(input.comment !== undefined ? { comment: input.comment } : {}) } as Prisma.InputJsonValue, recipientName: input.recipientName, recipientPhone: input.recipientPhone,
      subtotal: quote.subtotal, deliveryFee: quote.deliveryFee, total: quote.total, status: 'PENDING_ACCEPTANCE',
      items: { create: quote.items.map(({ total: _total, ...item }) => item) },
      payment: { create: { method: input.paymentMethod, status: input.paymentMethod === 'CARD' ? 'AWAITING_CONFIRMATION' : 'AWAITING_PAYMENT', receiptId } },
    }, include: orderInclude });
    const user = await tx.user.update({ where: { id: userId }, data: { recipientName: input.recipientName, phone: input.recipientPhone, deliveryAddressId: address.id }, select: { settings: { select: { language: true } } } });
    const notification = await tx.notification.create({ data: { userId, type: 'ORDER_CREATED', title: 'Заказ создан', body: `${quote.restaurant.name} · ожидает принятия`, link: `/orders`, metadata: { orderId: order.id, restaurantName: quote.restaurant.name, status: order.status } } });
    return { order, notification, language: user.settings?.language };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  ioEvent(`user:${userId}`, 'order:updated', customerOrderJson(result.order));
  ioEvent(`user:${userId}`, 'notification', notificationDto(result.notification, result.language));
  res.status(201).json({ data: customerOrderJson(result.order) });
});
