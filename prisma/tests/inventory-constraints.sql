-- Run against a migrated development/test database. All fixture rows roll back.
-- PostgreSQL sequences can still advance even though the rows are rolled back.
BEGIN;

CREATE FUNCTION pg_temp.expect_failure(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN
            RETURN;
        END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE % for statement: %', expected_state, statement;
END;
$$;

DO $$
DECLARE
    prefix TEXT := 'inventory-test-' || txid_current()::TEXT;
    first_item INTEGER;
    second_item INTEGER;
    activity_count INTEGER;
    net_quantity INTEGER;
    unit_value DECIMAL(12,2);
BEGIN
    INSERT INTO "Item" ("code", "displayName")
    VALUES (prefix || '-shirt', 'Test shirt') RETURNING "id" INTO first_item;
    INSERT INTO "Item" ("code", "displayName")
    VALUES (prefix || '-pants', 'Test pants') RETURNING "id" INTO second_item;

    -- Identical submission IDs in different forms are allowed.
    INSERT INTO "SourceSubmission"
        ("jotformFormId", "jotformSubmissionId", "location", "sourceType", "submissionDate")
    VALUES
        (prefix || '-form-a', prefix || '-shared', 'LOWCOUNTRY', 'INVENTORY', now()),
        (prefix || '-form-b', prefix || '-shared', 'MIDLANDS', 'INVENTORY', now()),
        (prefix || '-form-b', prefix || '-only-b', 'MIDLANDS', 'REFERRAL', now());

    INSERT INTO "InventoryActivity"
        ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction")
    VALUES
        (prefix || '-form-a', prefix || '-shared', first_item, 5, 'IN'),
        (prefix || '-form-a', prefix || '-shared', second_item, 2, 'IN'),
        (prefix || '-form-b', prefix || '-only-b', first_item, 3, 'OUT');

    SELECT count(*) INTO activity_count FROM "InventoryActivity"
    WHERE "jotformFormId" = prefix || '-form-a' AND "jotformSubmissionId" = prefix || '-shared';
    IF activity_count <> 2 THEN
        RAISE EXCEPTION 'A submission must support multiple item activities';
    END IF;

    SELECT sum(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END)
    INTO net_quantity FROM "InventoryActivity" WHERE "itemId" = first_item;
    IF net_quantity <> 2 THEN
        RAISE EXCEPTION 'IN/OUT activities must produce the expected net movement';
    END IF;

    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "Item" ("code", "displayName") VALUES (%L, %L)',
        prefix || '-shirt', 'Duplicate code'), '23505');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "SourceSubmission" ("jotformFormId", "jotformSubmissionId", "location", "sourceType", "submissionDate") VALUES (%L, %L, %L, %L, now())',
        prefix || '-form-a', prefix || '-shared', 'LOWCOUNTRY', 'INVENTORY'), '23505');

    -- Both source fields must match the same source row.
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "InventoryActivity" ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction") VALUES (%L, %L, %s, 1, %L)',
        prefix || '-form-a', prefix || '-only-b', first_item, 'IN'), '23503');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "InventoryActivity" ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction") VALUES (%L, %L, -2147483648, 1, %L)',
        prefix || '-form-a', prefix || '-shared', 'IN'), '23503');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "InventoryActivity" ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction") VALUES (%L, %L, %s, 0, %L)',
        prefix || '-form-a', prefix || '-shared', first_item, 'IN'), '23514');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "InventoryActivity" ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction") VALUES (%L, %L, %s, -1, %L)',
        prefix || '-form-a', prefix || '-shared', first_item, 'OUT'), '23514');

    INSERT INTO "StartingInventory" ("itemId", "year", "location", "startingQuantity")
    VALUES (first_item, 2026, 'LOWCOUNTRY', 10),
           (first_item, 2026, 'MIDLANDS', 20),
           (first_item, 2027, 'LOWCOUNTRY', 0);
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "StartingInventory" ("itemId", "year", "location", "startingQuantity") VALUES (%s, 2026, %L, 5)',
        first_item, 'LOWCOUNTRY'), '23505');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "StartingInventory" ("itemId", "year", "location", "startingQuantity") VALUES (%s, 2028, %L, -1)',
        first_item, 'LOWCOUNTRY'), '23514');

    INSERT INTO "ItemValuation" ("itemId", "year", "valuePerUnit")
    VALUES (first_item, 2026, 7.25), (first_item, 2027, 0);
    SELECT "valuePerUnit" INTO unit_value FROM "ItemValuation"
    WHERE "itemId" = first_item AND "year" = 2026;
    IF unit_value <> 7.25 THEN
        RAISE EXCEPTION 'Per-unit valuation must preserve cents exactly';
    END IF;
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "ItemValuation" ("itemId", "year", "valuePerUnit") VALUES (%s, 2026, 9.00)', first_item), '23505');
    PERFORM pg_temp.expect_failure(format(
        'INSERT INTO "ItemValuation" ("itemId", "year", "valuePerUnit") VALUES (%s, 2028, -0.01)', first_item), '23514');

    -- Inventory history must not be silently deleted with its item or source.
    PERFORM pg_temp.expect_failure(format('DELETE FROM "Item" WHERE "id" = %s', first_item), '23503');
    PERFORM pg_temp.expect_failure(format(
        'DELETE FROM "SourceSubmission" WHERE "jotformFormId" = %L AND "jotformSubmissionId" = %L',
        prefix || '-form-a', prefix || '-shared'), '23503');
END;
$$;

ROLLBACK;
