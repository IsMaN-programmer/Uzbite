import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../config/database.js';
import { assert } from '../utils/errors.js';
import { jsonValue } from '../utils/serialize.js';
import { postDto, postInclude, restaurantDto, restaurantInclude, commentUserSelect } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { ioEvent } from '../services/realtime.js';
import { paginationSchema, pageMetadata } from '../utils/pagination.js';
import { notificationDto } from '../services/notifications.js';
import { deliveryAddressForUser, deliveryEstimateFor } from '../services/delivery.js';

export const catalogRouter = Router();
catalogRouter.get('/restaurants', async (req, res) => {
  const { page, pageSize } = paginationSchema.parse(req.query);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 100) : '';
  const filters = z.object({ open: z.enum(['true', 'false']).optional(), freeDelivery: z.enum(['true', 'false']).optional(), sort: z.enum(['name', 'delivery', 'popular']).default('name') }).parse(req.query);
  const where = {
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }, { dishes: { some: { name: { contains: q, mode: 'insensitive' as const } } } }, { categories: { some: { name: { contains: q, mode: 'insensitive' as const } } } }] } : {}),
    ...(category ? { categories: { some: { name: { contains: category, mode: 'insensitive' as const } } } } : {}),
    ...(filters.open === 'true' ? { isOpen: true } : {}),
    ...(filters.freeDelivery === 'true' ? { deliveryFee: 0 } : {}),
  };
  const orderBy: Prisma.RestaurantOrderByWithRelationInput[] = [
    ...(filters.sort === 'delivery' ? [{ deliveryFee: 'asc' as const }] : filters.sort === 'popular' ? [{ follows: { _count: 'desc' as const } }] : []),
    { name: 'asc' }, { id: 'asc' },
  ];
  const [items, total, delivery] = await Promise.all([db.restaurant.findMany({ where, include: { ...restaurantInclude(req.user?.id), categories: { select: { name: true }, orderBy: { sortOrder: 'asc' } } }, skip: (page - 1) * pageSize, take: pageSize, orderBy }), db.restaurant.count({ where }), deliveryAddressForUser(req.user?.id)]);
  res.json({ data: jsonValue({ items: items.map(item => { const { categories, ...restaurant } = item; return { ...restaurantDto(restaurant), cuisines: categories.map(category => category.name), deliveryEstimate: deliveryEstimateFor(restaurant, delivery.address) }; }), page, pageSize, total, hasMore: page * pageSize < total }) });
});
catalogRouter.get('/categories', async (_req, res) => {
  const items = await db.restaurantCategory.findMany({ distinct: ['name'], select: { name: true }, orderBy: { name: 'asc' } });
  res.json({ data: items.map(item => item.name) });
});
catalogRouter.get('/restaurants/:id', async (req, res) => {
  const restaurant = await db.restaurant.findFirst({ where: { OR: [{ id: req.params.id as string }, { slug: req.params.id as string }] }, include: { ...restaurantInclude(req.user?.id), categories: { orderBy: { sortOrder: 'asc' } }, dishes: { orderBy: { name: 'asc' } }, posts: { include: postInclude(req.user?.id), orderBy: { createdAt: 'desc' } } } });
  assert(restaurant, 404, 'NOT_FOUND', 'Ресторан не найден');
  const reviews = await db.review.findMany({ where: { restaurantId: restaurant.id }, include: { user: { select: commentUserSelect } }, orderBy: { createdAt: 'desc' }, take: 50 });
  const delivery = await deliveryAddressForUser(req.user?.id);
  res.json({ data: jsonValue({ ...restaurantDto(restaurant), deliveryEstimate: deliveryEstimateFor(restaurant, delivery.address), posts: restaurant.posts.map(postDto), reviews: reviews.map(review => ({ ...review, verified: true })) }) });
});
catalogRouter.get('/feed', async (req, res) => {
  const { page, pageSize } = paginationSchema.parse(req.query);
  const following = req.query.following === 'true';
  const where = following ? { restaurant: { follows: { some: { userId: req.user?.id ?? '__guest__' } } } } : {};
  const [items, total] = await Promise.all([db.post.findMany({ where, include: postInclude(req.user?.id), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }), db.post.count({ where })]);
  res.json({ data: jsonValue({ items: items.map(postDto), page, pageSize, total, hasMore: page * pageSize < total }) });
});
catalogRouter.get('/posts/:id', async (req, res) => {
  const post = await db.post.findUnique({ where: { id: req.params.id as string }, include: postInclude(req.user?.id) });
  assert(post, 404, 'NOT_FOUND', 'Публикация не найдена');
  res.json({ data: jsonValue(postDto(post)) });
});
catalogRouter.put('/posts/:id/like', requireAuth, rateLimit('social', 240, 300), async (req, res) => {
  const { liked } = z.object({ liked: z.boolean() }).strict().parse(req.body);
  const postId = req.params.id as string;
  assert(await db.post.findUnique({ where: { id: postId }, select: { id: true } }), 404, 'NOT_FOUND', 'Публикация не найдена');
  if (liked) await db.like.upsert({ where: { userId_postId: { userId: req.user!.id, postId } }, create: { userId: req.user!.id, postId }, update: {} });
  else await db.like.deleteMany({ where: { userId: req.user!.id, postId } });
  res.json({ data: { isLiked: liked, likeCount: await db.like.count({ where: { postId } }) } });
});
catalogRouter.put('/restaurants/:id/follow', requireAuth, rateLimit('social', 240, 300), async (req, res) => {
  const { following } = z.object({ following: z.boolean() }).strict().parse(req.body);
  const restaurantId = req.params.id as string;
  assert(await db.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } }), 404, 'NOT_FOUND', 'Ресторан не найден');
  if (following) await db.follow.upsert({ where: { userId_restaurantId: { userId: req.user!.id, restaurantId } }, create: { userId: req.user!.id, restaurantId }, update: {} });
  else await db.follow.deleteMany({ where: { userId: req.user!.id, restaurantId } });
  res.json({ data: { isFollowing: following, followerCount: await db.follow.count({ where: { restaurantId } }) } });
});
catalogRouter.get('/posts/:id/comments', async (req, res) => {
  const { page, pageSize } = paginationSchema.parse(req.query);
  const postId = req.params.id as string;
  assert(await db.post.findUnique({ where: { id: postId }, select: { id: true } }), 404, 'NOT_FOUND', 'Публикация не найдена');
  const where = { postId, parentId: null };
  const [items, total] = await Promise.all([
    db.comment.findMany({ where, include: { user: { select: commentUserSelect }, replies: { include: { user: { select: commentUserSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    db.comment.count({ where }),
  ]);
  res.json({ data: items, pagination: pageMetadata(page, pageSize, total) });
});
catalogRouter.post('/posts/:id/comments', requireAuth, rateLimit('comments', 30, 300), async (req, res) => {
  const { text, parentId } = z.object({ text: z.string().trim().min(1).max(2000), parentId: z.string().max(100).optional() }).strict().parse(req.body);
  const postId = req.params.id as string;
  assert(await db.post.findUnique({ where: { id: postId }, select: { id: true } }), 404, 'NOT_FOUND', 'Публикация не найдена');
  const parent = parentId ? await db.comment.findUnique({ where: { id: parentId } }) : null;
  if (parentId) assert(parent && parent.postId === postId && !parent.parentId, 400, 'INVALID_REPLY', 'Ответ должен относиться к комментарию этой публикации');
  const { comment, notification, language } = await db.$transaction(async tx => {
    const created = await tx.comment.create({ data: { userId: req.user!.id, postId, text, parentId }, include: { user: { select: commentUserSelect } } });
    const notice = parent && parent.userId !== req.user!.id ? await tx.notification.create({ data: { userId: parent.userId, type: 'COMMENT_REPLY', title: 'Новый ответ', body: `${created.user.name} ответил на ваш комментарий`, link: `/feed?post=${postId}`, metadata: { authorName: created.user.name, postId } } }) : null;
    const settings = notice ? await tx.userSettings.findUnique({ where: { userId: notice.userId } }) : null;
    return { comment: created, notification: notice, language: settings?.language };
  });
  if (notification) ioEvent(`user:${notification.userId}`, 'notification', notificationDto(notification, language));
  ioEvent(`post:${postId}`, 'comment:created', { postId, comment });
  res.status(201).json({ data: comment });
});
catalogRouter.post('/restaurants/:id/reviews', requireAuth, rateLimit('reviews', 20, 3600), async (req, res) => {
  const input = z.object({ orderId: z.string().min(1).max(100), rating: z.number().int().min(1).max(5), text: z.string().trim().min(3).max(2000) }).strict().parse(req.body);
  const order = await db.order.findUnique({ where: { id: input.orderId } });
  assert(order && order.userId === req.user!.id && order.restaurantId === req.params.id, 404, 'NOT_FOUND', 'Заказ не найден');
  assert(order.status === 'DELIVERED', 403, 'REVIEW_NOT_ALLOWED', 'Оставить отзыв можно только после доставки заказа');
  const review = await db.review.create({ data: { ...input, userId: req.user!.id, restaurantId: order.restaurantId }, include: { user: { select: commentUserSelect } } });
  res.status(201).json({ data: { ...review, verified: true } });
});
