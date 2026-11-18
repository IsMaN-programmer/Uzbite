import { CatalogCategory, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { DiscoverySort } from '@uzbite/shared';
import { db } from '../config/database.js';
import { paginationSchema } from '../utils/pagination.js';
import { restaurantDto, restaurantInclude } from './catalog.js';

const discoverySorts = ['all', 'price-asc', 'price-desc', 'popular', 'rating'] as const satisfies readonly DiscoverySort[];
const catalogCategorySchema = z.enum(CatalogCategory);
export const discoveryQuery = paginationSchema.extend({
  q: z.string().trim().transform(value => value.slice(0, 100)).default(''),
  category: z.string().trim().transform(value => value.slice(0, 100)).default(''),
  open: z.enum(['true', 'false']).optional(),
  // Older clients can still read the catalog with their existing filters.
  freeDelivery: z.enum(['true', 'false']).optional(),
  sort: z.enum([...discoverySorts, 'name', 'delivery']).default('all'),
});

function contains(field: Prisma.Sql, value: string) {
  return Prisma.sql`strpos(lower(${field}), lower(${value})) > 0`;
}

export async function discoverRestaurants(input: z.infer<typeof discoveryQuery>, userId?: string) {
  const { q, category, open, freeDelivery, sort, page, pageSize } = input;
  const picked = catalogCategorySchema.safeParse(category);
  const sections = Prisma.sql`FROM "RestaurantCategory" c WHERE c."restaurantId" = r.id`;
  const legacyCategory = category ? Prisma.sql`${sections} AND ${contains(Prisma.sql`c."name"`, category)}` : Prisma.empty;
  const dishCategory = picked.success
    ? Prisma.sql`AND d."catalogCategory" = ${picked.data}::"CatalogCategory"`
    : category ? Prisma.sql`AND d."categoryId" IN (SELECT c.id ${legacyCategory})` : Prisma.empty;
  const menu = Prisma.sql`
    FROM "Dish" d
    WHERE d."restaurantId" = r.id AND d."isAvailable" ${dishCategory}`;
  const conditions: Prisma.Sql[] = [];

  if (open === 'true') conditions.push(Prisma.sql`r."isOpen"`);
  if (freeDelivery === 'true') conditions.push(Prisma.sql`r."deliveryFee" = 0`);
  if (picked.success) conditions.push(Prisma.sql`EXISTS (SELECT 1 ${menu})`);
  else if (category) conditions.push(Prisma.sql`EXISTS (SELECT 1 ${legacyCategory})`);

  if (q) {
    const dishName = contains(Prisma.sql`d."name"`, q);
    const sectionName = contains(Prisma.sql`c."name"`, q);
    const menuMatch = picked.success
      ? Prisma.sql`EXISTS (SELECT 1 ${menu} AND (${dishName} OR d."categoryId" IN (SELECT c.id ${sections} AND ${sectionName})))`
      : Prisma.sql`EXISTS (SELECT 1 FROM "Dish" d WHERE d."restaurantId" = r.id AND ${dishName})
        OR EXISTS (SELECT 1 ${sections} AND ${sectionName})`;
    conditions.push(Prisma.sql`(
      ${contains(Prisma.sql`r."name"`, q)} OR ${contains(Prisma.sql`r."description"`, q)} OR ${menuMatch}
    )`);
  }

  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  const orderBy: Partial<Record<typeof sort, Prisma.Sql>> = {
    'price-asc': Prisma.sql`(SELECT MIN(d."price") ${menu}) ASC NULLS LAST,`,
    'price-desc': Prisma.sql`(SELECT MAX(d."price") ${menu}) DESC NULLS LAST,`,
    popular: Prisma.sql`(SELECT COUNT(*) FROM "Follow" f WHERE f."restaurantId" = r.id) DESC,`,
    rating: Prisma.sql`(SELECT AVG(v."rating") FROM "Review" v WHERE v."restaurantId" = r.id) DESC NULLS LAST,`,
    delivery: Prisma.sql`r."deliveryFee" ASC,`,
  };

  // Rank the filtered catalog before slicing it into pages. Name and ID break ties consistently.
  const [pageRows, counts] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "Restaurant" r ${where}
      ORDER BY ${orderBy[sort] ?? Prisma.empty} r."name" ASC, r.id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM "Restaurant" r ${where}`,
  ]);
  const records = await db.restaurant.findMany({
    where: { id: { in: pageRows.map(row => row.id) } },
    include: { ...restaurantInclude(userId), categories: { select: { name: true }, orderBy: { sortOrder: 'asc' } } },
  });
  const byId = new Map(records.map(record => {
    const { categories, ...restaurant } = record;
    return [record.id, { ...restaurantDto(restaurant), cuisines: categories.map(section => section.name) }] as const;
  }));
  const items = pageRows.flatMap(({ id }) => {
    const restaurant = byId.get(id);
    return restaurant ? [restaurant] : [];
  });
  const total = Number(counts[0]?.total ?? 0);
  return { items, total, page, pageSize, hasMore: page * pageSize < total };
}
