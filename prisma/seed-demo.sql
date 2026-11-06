-- Fictional fixtures for a development/test database, not approved IRS values
-- or real Jotform records. Fixed identifiers make sequential reruns idempotent.
BEGIN;

INSERT INTO "Item" ("code", "displayName") VALUES
    ('DEMO_TOPS', 'Demo tops'),
    ('DEMO_BOTTOMS', 'Demo bottoms')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "ItemValuation" ("itemId", "year", "valuePerUnit")
SELECT item."id", 2026, fixture.value
FROM (VALUES
    ('DEMO_TOPS', 5.00::DECIMAL(12,2)),
    ('DEMO_BOTTOMS', 7.50::DECIMAL(12,2))
) AS fixture(code, value)
JOIN "Item" AS item ON item."code" = fixture.code
ON CONFLICT ("itemId", "year") DO NOTHING;

INSERT INTO "StartingInventory" ("itemId", "year", "location", "startingQuantity")
SELECT item."id", 2026, fixture.location, fixture.quantity
FROM (VALUES
    ('DEMO_TOPS', 'LOWCOUNTRY'::"Location", 100),
    ('DEMO_BOTTOMS', 'LOWCOUNTRY'::"Location", 80),
    ('DEMO_TOPS', 'MIDLANDS'::"Location", 60),
    ('DEMO_BOTTOMS', 'MIDLANDS'::"Location", 40)
) AS fixture(code, location, quantity)
JOIN "Item" AS item ON item."code" = fixture.code
ON CONFLICT ("itemId", "year", "location") DO NOTHING;

WITH fixture(location, direction, source_type, submission_date, tops_quantity, bottoms_quantity) AS (
    VALUES
        ('LOWCOUNTRY'::"Location", 'IN'::"InventoryDirection", 'INVENTORY'::"SourceType", '2026-01-02T12:00:00Z'::TIMESTAMPTZ, 20, 10),
        ('LOWCOUNTRY'::"Location", 'OUT'::"InventoryDirection", 'REFERRAL'::"SourceType", '2026-01-03T12:00:00Z'::TIMESTAMPTZ, 5, 3),
        ('MIDLANDS'::"Location", 'IN'::"InventoryDirection", 'INVENTORY'::"SourceType", '2026-01-02T12:00:00Z'::TIMESTAMPTZ, 12, 8),
        ('MIDLANDS'::"Location", 'OUT'::"InventoryDirection", 'REFERRAL'::"SourceType", '2026-01-03T12:00:00Z'::TIMESTAMPTZ, 4, 2)
), new_submissions AS (
    INSERT INTO "SourceSubmission"
        ("jotformFormId", "jotformSubmissionId", "location", "sourceType", "submissionDate")
    SELECT
        'SEED_DEMO_' || location::TEXT || '_' || source_type::TEXT,
        'SEED_DEMO_2026_' || location::TEXT || '_' || direction::TEXT,
        location, source_type, submission_date
    FROM fixture
    ON CONFLICT ("jotformFormId", "jotformSubmissionId") DO NOTHING
    RETURNING "jotformFormId", "jotformSubmissionId", "location", "sourceType"
)
INSERT INTO "InventoryActivity"
    ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction")
SELECT source."jotformFormId", source."jotformSubmissionId", item."id", movement.quantity, fixture.direction
FROM new_submissions AS source
JOIN fixture ON fixture.location = source."location" AND fixture.source_type = source."sourceType"
CROSS JOIN LATERAL (VALUES
    ('DEMO_TOPS', fixture.tops_quantity),
    ('DEMO_BOTTOMS', fixture.bottoms_quantity)
) AS movement(code, quantity)
JOIN "Item" AS item ON item."code" = movement.code;

-- Only newly inserted sources receive activities. Existing sources are left
-- untouched, so reruns cannot append another set of inventory movements.
COMMIT;
