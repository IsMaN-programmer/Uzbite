ALTER TABLE "Dish"
    ADD COLUMN "weightGrams" INTEGER,
    ADD COLUMN "volumeMl" INTEGER,
    ADD COLUMN "piecesPerPortion" INTEGER,
    ADD COLUMN "diameterCm" INTEGER;

-- Portion sizes for existing entries in the fictional demo catalog.
UPDATE "Dish" AS dish
SET "weightGrams" = seed.weight_grams,
    "volumeMl" = seed.volume_ml,
    "piecesPerPortion" = seed.pieces,
    "diameterCm" = seed.diameter_cm
FROM (VALUES
    ('dish-plov', 'rest-osh', 350, NULL, NULL, NULL),
    ('dish-samsa', 'rest-osh', NULL, NULL, 2, NULL),
    ('dish-achichuk', 'rest-osh', 180, NULL, NULL, NULL),
    ('dish-pasta', 'rest-basilico', 300, NULL, NULL, NULL),
    ('dish-pizza', 'rest-basilico', NULL, NULL, NULL, 30),
    ('dish-salad', 'rest-basilico', 200, NULL, NULL, NULL),
    ('dish-burger', 'rest-burger', 260, NULL, NULL, NULL),
    ('dish-fries', 'rest-burger', 150, NULL, NULL, NULL),
    ('dish-double', 'rest-burger', 340, NULL, NULL, NULL),
    ('dish-breakfast', 'rest-non', 280, NULL, NULL, NULL),
    ('dish-croissant', 'rest-non', 75, NULL, NULL, NULL),
    ('dish-coffee', 'rest-non', NULL, 250, NULL, NULL),
    ('dish-noodles', 'rest-mori', 320, NULL, NULL, NULL),
    ('dish-roll', 'rest-mori', NULL, NULL, 8, NULL),
    ('dish-rice', 'rest-mori', 280, NULL, NULL, NULL),
    ('dish-curry', 'rest-saffron', 320, NULL, NULL, NULL),
    ('dish-biryani', 'rest-saffron', 350, NULL, NULL, NULL),
    ('dish-tea', 'rest-saffron', NULL, 250, NULL, NULL)
) AS seed(id, restaurant_id, weight_grams, volume_ml, pieces, diameter_cm)
WHERE dish.id = seed.id AND dish."restaurantId" = seed.restaurant_id;
