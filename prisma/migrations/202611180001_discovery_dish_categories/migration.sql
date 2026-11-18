CREATE TYPE "CatalogCategory" AS ENUM (
    'NATIONAL', 'FAST_FOOD', 'FOREIGN', 'EASTERN', 'ASIAN',
    'DRINKS', 'SALADS', 'MEAT', 'SNACKS', 'OTHER'
);

ALTER TABLE "Dish" ADD COLUMN "catalogCategory" "CatalogCategory" NOT NULL DEFAULT 'OTHER';

UPDATE "Dish" AS dish
SET "catalogCategory" = seed.category::"CatalogCategory"
FROM (VALUES
    ('dish-plov', 'rest-osh', 'NATIONAL'),
    ('dish-samsa', 'rest-osh', 'NATIONAL'),
    ('dish-achichuk', 'rest-osh', 'SALADS'),
    ('dish-pasta', 'rest-basilico', 'FOREIGN'),
    ('dish-pizza', 'rest-basilico', 'FOREIGN'),
    ('dish-salad', 'rest-basilico', 'SALADS'),
    ('dish-burger', 'rest-burger', 'FAST_FOOD'),
    ('dish-fries', 'rest-burger', 'SNACKS'),
    ('dish-double', 'rest-burger', 'FAST_FOOD'),
    ('dish-coffee', 'rest-non', 'DRINKS'),
    ('dish-noodles', 'rest-mori', 'ASIAN'),
    ('dish-roll', 'rest-mori', 'ASIAN'),
    ('dish-rice', 'rest-mori', 'ASIAN'),
    ('dish-curry', 'rest-saffron', 'MEAT'),
    ('dish-biryani', 'rest-saffron', 'EASTERN'),
    ('dish-tea', 'rest-saffron', 'DRINKS')
) AS seed(id, restaurant_id, category)
WHERE dish.id = seed.id AND dish."restaurantId" = seed.restaurant_id;

CREATE INDEX "Dish_catalogCategory_isAvailable_restaurantId_idx"
ON "Dish"("catalogCategory", "isAvailable", "restaurantId");
