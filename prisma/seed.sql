-- Starter categories. Match these codes to the normalizer's item mapping.
-- Existing item codes and display names are preserved on reruns.
BEGIN;

INSERT INTO "Item" ("code", "displayName") VALUES
    ('TOPS', 'Tops'),
    ('BOTTOMS', 'Bottoms'),
    ('JACKETS', 'Jackets'),
    ('DRESSES', 'Dresses'),
    ('PAJAMAS', 'Pajamas'),
    ('UNDERWEAR', 'Underwear'),
    ('SOCKS', 'Socks'),
    ('SHOES', 'Shoes'),
    ('BLANKETS', 'Blankets'),
    ('DIAPERS', 'Diapers'),
    ('PULL_UPS', 'Pull-ups'),
    ('WIPES', 'Wipes'),
    ('TOILETRIES', 'Toiletries'),
    ('SCHOOL_UNIFORM_TOPS', 'School uniform tops'),
    ('SCHOOL_UNIFORM_BOTTOMS', 'School uniform bottoms')
ON CONFLICT ("code") DO NOTHING;

COMMIT;
