ALTER TABLE "products"
ADD COLUMN "weightGrams" INTEGER NOT NULL DEFAULT 100;

-- Descriptions with a gram value provide a provisional estimate; all other
-- existing products retain the explicit 100 g provisional default.
UPDATE "products"
SET "weightGrams" = (regexp_match("description", '([0-9]{1,9})[[:space:]]*g'))[1]::INTEGER
WHERE "description" ~* '[0-9]{1,9}[[:space:]]*g'
  AND (regexp_match("description", '([0-9]{1,9})[[:space:]]*g'))[1]::INTEGER > 0;

ALTER TABLE "products"
ADD CONSTRAINT "products_weight_grams_positive" CHECK ("weightGrams" > 0);
