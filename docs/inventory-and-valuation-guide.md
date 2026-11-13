# Inventory and Valuation Calculation Guide

## 1. Purpose of This Guide

This guide explains where the inventory figures displayed by the application come from and how quantities and dollar values are calculated. It is intended to support a transparent client handoff and help staff trace dashboard figures during an audit.

The guide describes the application rules and the client-provided business rules reviewed for this handoff. Where an original source document or an actual starting-count record was not available, that limitation is called out rather than filled in with an assumption.

## 2. Information Flow at a Glance

1. A starting count is recorded for each inventory category, location, and year.
2. Inventory form submissions add items or record removals.
3. Referral submissions represent items distributed in care kits.
4. Referral answers are converted into standard inventory categories and quantities.
5. The selected year's item valuations are applied to the counts.
6. The selected year and location determine which starting counts and movements are included.
7. The application calculates the item rows and the dashboard's overall quantity and value summaries.

## 3. Data Sources

### Starting Inventory

The client procedure describes an annual physical count of items in both buildings, normally during the last week of December or first week of January. In the application, a starting count is stored by item category, location (Lowcountry or Midlands), and year. It is the opening quantity used for that selected year; the record does not store the physical-count date.

Starting counts use the same item categories as the dashboard. If a starting-count record is absent for an item, year, and location, the application uses zero. An authorized user can edit starting counts in the Inventory Editor for the selected year and location. A JSON import utility can also add starting counts, but it skips records that already exist. The example file at [`examples/starting-inventory.example.json`](../examples/starting-inventory.example.json) is illustrative only; it is not the client's actual count record.

The actual opening-count source sheet and values were not available for this guide. Therefore, this guide explains how the application uses a starting count but cannot certify the live starting figures against a physical count.

### Inventory Additions

The application is configured for one inventory form for each location. Under the client-provided procedure, donated items are sorted twice and unacceptable items are excluded before accepted donations are entered; mailed donations are counted on receipt. Stocking-drive items are counted when brought into the building for use. A positive quantity is an addition. The form determines the location, and the form field determines the inventory category.

The client procedure classifies onesies, rompers, and jumpers as tops; overalls as bottoms; and hoodies as either tops or jackets. The application does not inspect garment descriptions to choose a category, so staff must enter each count in the appropriate form field consistently.

For Jotform imports, the submission's creation time determines its date; the update time is used only if the creation time is absent. A Jotform timestamp without a time-zone offset is interpreted as Eastern time and converted to UTC before the dashboard assigns a year. See [Inventory submission normalization](../lib/jotform/normalize-inventory.ts) and [the configured form importer](../lib/jotform/import-submissions.ts).

The inventory form does not identify whether an item is holiday-themed. The client procedure says holiday-themed books, clothing, and stuffed animals are not counted, so the application relies on staff to leave those items out of the entered quantities.

### Inventory Subtractions

An inventory form quantity may be positive or negative. A positive number adds stock; a negative number records a removal. The application stores the removal as a positive quantity with an “out” direction, rather than storing a negative quantity.

For example:

- `+10 shirts` adds ten shirts.
- `-3 shirts` removes three shirts.

Positive and negative values can appear in the same submission. Blank and zero fields are skipped. Text, fractional quantities, and other invalid values are rejected for that submission rather than counted. A later-rejected donation can be entered as a negative quantity, as described in the client procedure. The calculated balance is not capped at zero, so it can be negative if recorded removals exceed the opening count and additions.

Referral distributions are also removals. As a result, the dashboard's “Items distributed” figure includes all “out” movements, including negative inventory-form adjustments, not only care-kit distributions.

### Referral Forms

The application is configured for a Lowcountry referral form and a Midlands referral form. The form ID determines the location. A “Yes” answer on an item request creates the standard quantity for that item, and the item's type answer determines the inventory category. A referral creates removals from inventory.

Every referral submission also removes two books and two stuffed animals. These are added by the application because the client procedure says they are included in every care kit; case workers do not select them on the form.

The current Jotform import saves new submission IDs and skips IDs that were already saved. It does not update a saved submission when its answers later change. The offline sheet-normalization code can process an explicitly supplied cancellation flag or changed row, but there is no configured live Google Sheet connection in the reviewed application. It does not detect yellow cell highlighting by itself. Therefore, source-sheet edits and highlighted cancellations are not automatically reflected in dashboard figures.

### Item Valuations

The client-provided valuation policy says values are based on a weighted average of “Better than Good” and “Excellent” conditions; socks and underwear use “Excellent” condition only. The application does not calculate a condition-weighted average. It uses the dollar amounts in its valuation catalogue for the selected year.

The source valuation list supplied for this guide has no visible effective year. The application seeds those listed amounts for reporting year 2026 by default. An authorized user can edit the valuation for a selected year; the valuation is shared by Lowcountry and Midlands for that year. The application does not automatically update valuations from an IRS sheet.

The written client policy says blankets are not counted, but both inventory forms contain a blanket quantity field that the application maps to “Baby Blanket.” Per the client's direction to leave the existing application behavior unchanged, a submitted blanket quantity is included in inventory. There is no blanket request field on the referral forms, so the application does not subtract blanket distributions.

## 4. Standard Referral Item Quantities

The following standard quantities were checked against the referral normalizer and its tests. A selected request is recorded in the corresponding category; an unselected request contributes zero. Books and stuffed animals are automatic additions to each referral, as explained below.

| Item | Standard quantity |
| ----------------------------- | --------------------------: |
| Shirts | 5 |
| Pants/Shorts | 4 |
| Shoes | 1 pair |
| Socks | 1 bundle containing 5 pairs |
| Underwear | 1 bundle containing 5 pairs |
| Pajamas | 1 set |
| Dresses | 2 |
| Jacket | 1 |
| Toiletry Kit | 1 kit |
| Backpack with School Supplies | 1 backpack |
| Uniform Shirts | 2 |
| Uniform Pants/Shorts | 2 |
| Books | 2 |
| Stuffed Animals | 2 |

Socks and underwear are recorded as one inventory unit per five-pair bundle, not five inventory units. The incoming-inventory policy also says that each five-pair bundle is counted as one unit. Their dollar values are adjusted separately in Section 8.

Diapers and pull-ups are counted by the pack, not by the individual diaper or pull-up. The referral form selects one pack. Wipes and toiletry kits are also counted as one pack or one assembled kit per selected request.

## 5. How Referral Answers Map to Categories

For clothing groups that have male and female branches:

| Referral type answer | Dashboard category |
| -------------------- | ------------------ |
| Female type = Adult | Women |
| Male type = Adult | Men |
| Female type = Child/Baby | Children |
| Male type = Child/Baby | Children |

The classification is made separately for each item group. The answer “Child's Sex” selects the applicable male or female type field; the type answer then determines Adult versus Child/Baby. Socks use the same type field as shoes. Uniform tops and bottoms use the corresponding tops and bottoms type fields.

For a selected item, a missing or unrecognized sex/type answer is not treated as an adult, male, or female default; the submission is rejected during import. Dresses use the form's single “Female Dresses Type” answer, which maps Adult to women's dresses and Child/Baby to children's dresses. The application does not create a men's dresses category.

In the valuation policy, tops generally include shirts, sweaters, and sweatshirts; children's tops also include onesies. Men's bottoms include pants, sweatpants, and shorts; women's and children's bottoms also include skirts. These descriptions explain the categories but are not automatically evaluated from a garment description by the application.

| Referral form answer | Type answer used | Inventory category | Quantity rule |
| -------------------- | ---------------- | ------------------ | ------------: |
| “Tops?” = Yes | Male/Female Tops Type | Men's, Women's, or Children's Tops | 5 |
| “Bottoms?” = Yes | Male/Female Bottoms Type | Men's, Women's, or Children's Bottoms | 4 |
| “Shoes?” = Yes | Male/Female Shoes Type | Men's, Women's, or Children's Shoes | 1 pair |
| “Socks?” = Yes | Male/Female Shoes Type | Men's, Women's, or Children's Socks | 1 five-pair bundle |
| “Underwear?” = Yes | Male/Female Underwear Type | Men's, Women's, or Children's Underwear | 1 five-pair bundle |
| “Jackets?” = Yes | Male/Female Jackets Type | Men's, Women's, or Children's Jackets & Hoodies | 1 |
| “Dresses?” = Yes | Female Dresses Type | Women's or Children's Dresses | 2 |
| “Pajamas?” = Yes | Male/Female Pajamas Type | Men's, Women's, or Children's Pajamas | 1, with the infant rule in Section 6 |
| “School Uniform Tops” = Yes | Male/Female Tops Type | Men's, Women's, or Children's Tops | 2 |
| “School Uniform Bottoms” = Yes | Male/Female Bottoms Type | Men's, Women's, or Children's Bottoms | 2 |
| “Toiletries” = Yes | Child's age | Age-banded toiletry kit | 1 kit |
| “Diapers or Pullups?” = Diapers | Not applicable | Diapers | 1 pack |
| “Diapers or Pullups?” = Pull Ups | Not applicable | Pull-Ups | 1 pack |
| Wipes = Yes | Not applicable | Wipes | 1 pack |
| “School” = Elementary School Bookbag & Supplies | Not applicable | Elementary backpack and supplies | 1 |
| “School” = Middle/High School Bookbag & Supplies | Not applicable | Middle/High backpack and supplies | 1 |
| No form answer (automatic care-kit items) | Not applicable | Books; Stuffed Animals | 2 of each |

The referral calculation does not store clothing sizes. For school uniforms, it uses the corresponding tops or bottoms type answer to choose the inventory category and records the fixed quantity of two. The client's note says uniform sizes match the corresponding tops and bottoms, but size-level matching is not represented in the application.

For toiletry kits, “0-3 Months,” “3-6 Months,” “6-9 Months,” and ages 1 through 5 map to the 0-5 kit. Ages 6 through 11 map to the 6-11 kit, and ages 12 through 18 map to the 12-18 kit. A selected toiletry request with a missing or unsupported age is rejected rather than assigned to a guessed kit.

## 6. Special Quantity Rules

### Infant Pajamas/Sleepers

The extra-sleeper rule applies only when “Pajamas?” is answered “Yes” and the type is “Child/Baby.” The normal quantity is one set. If the selected age answer is “0-3 Months,” “3-6 Months,” or “6-9 Months,” the application adds three more, for a total of four pajama units. The client confirmed that the entire “6-9 Months” form option qualifies; the form does not distinguish an exact age within that range. A child older than that range receives the normal one set.

When child/baby pajamas are selected, the import process requires a valid age answer. A missing or invalid age causes that submission to be rejected rather than guessing. If pajamas are not selected, they contribute zero.

### Automatic Care-Kit Items and Other Bundled Items

- Each referral submission includes two books and two stuffed animals, whether or not those items appear as selectable answers.
- Per client confirmation, these automatic deductions represent the regular, non-holiday care-kit items. Holiday distributions are outside the referral form and are not recorded through it.
- Socks and underwear stay as one five-pair bundle in inventory; the quantity is not expanded to five pairs.
- Diapers and pull-ups are packs of 30. The application records one pack for a selected referral request.
- Toiletry kits and backpacks are counted as assembled kits, not as each component inside the kit.
- The client procedure says blankets may be distributed to children under age one if available, but the referral form has no blanket field. The application therefore has no record of those distributions.

## 7. How Inventory Counts Are Calculated

For an item, year, and location, the dashboard uses the opening quantity recorded for that year and location. If no opening record exists, the opening quantity is zero.

**Total additions** are the quantities of included “in” movements:

`Total additions = sum of included inventory quantities recorded as IN`

**Total subtractions** are the positive quantities of included “out” movements. This includes negative inventory-form quantities and referral distributions:

`Total subtractions = sum of included inventory quantities recorded as OUT`

The stored quantity is always a positive magnitude; the direction determines whether it adds to or subtracts from inventory. Referrals are recorded as “out.”

**Current count** is:

`Current count = starting quantity + total additions − total subtractions`

No rule prevents a negative result. A negative balance remains visible as a negative count and is multiplied by the item's valuation when a valuation is available.

The dashboard also adds quantities across all item categories. Because an inventory unit may be a piece, pair, bundle, pack, kit, or backpack, the overall “Current count” is a sum of unlike units; it is not a count of individual physical pieces.

## 8. How Monetary Values Are Calculated

### Valuation Per Inventory Unit

The application assigns a dollar value to one counted inventory unit. The selected year's saved valuation is used for both locations. For most items, the stored value is the amount listed for one “Each,” pack, kit, or backpack in the client-provided valuation list.

For socks and underwear, the source list gives a value per pair, while inventory counts one bundle of five pairs. The application therefore multiplies the listed per-pair value by five:

`Bundle valuation = listed per-pair valuation × 5 pairs`

| Item category | Source amount per pair | Application value per five-pair bundle |
| ------------- | ---------------------: | --------------------------------------: |
| Men's socks | $3.00 | $15.00 |
| Women's socks | $1.35 | $6.75 |
| Children's socks | $1.60 | $8.00 |
| Men's underwear | $3.15 | $15.75 |
| Women's underwear | $3.15 | $15.75 |
| Children's underwear | $3.70 | $18.50 |

The remaining application catalogue reference values are listed below; the preceding table gives the source pair prices and saved bundle values for socks and underwear. These are the code's reference values for 2026 by default, not a confirmation of the current live database values; an authorized user may edit the selected year's values.

| Item category | Reference valuation per counted unit |
| ------------- | ------------------------------------: |
| Diapers (pack of 30) | $7.25 |
| Pull-Ups (pack of 30) | $7.25 |
| Wipes (pack) | $2.50 |
| Stuffed animals (each) | $9.25 |
| Books (each) | $0.75 |
| Baby blanket (each) | $5.53 |
| Care Kit laundry bag (each) | $3.98 |
| Men's tops | $10.12 |
| Men's bottoms | $8.80 |
| Men's jackets & hoodies | $21.67 |
| Men's pajamas | $6.83 |
| Men's shoes | $20.74 |
| Women's tops | $10.15 |
| Women's bottoms | $10.25 |
| Women's dresses | $16.03 |
| Women's jackets & hoodies | $10.50 |
| Women's pajamas | $10.50 |
| Women's shoes | $20.22 |
| Children's tops | $6.33 |
| Children's bottoms | $8.03 |
| Children's dresses | $10.38 |
| Children's jackets & hoodies | $20.48 |
| Children's pajamas | $5.48 |
| Children's shoes | $7.57 |
| Toiletry kit, ages 0-5 | $5.60 per kit |
| Toiletry kit, ages 6-11 | $10.50 per kit |
| Toiletry kit, ages 12-18 | $11.80 per kit |
| Elementary backpack with supplies | $52.63 per backpack |
| Middle/High backpack with supplies | $60.22 per backpack |

The client confirmed that $52.63 and $60.22 are the full backpack-kit values. The detailed supply lists in the provided policy total $17.63 and $25.22 respectively and are supply-only subtotals; they do not replace the full-kit values used by the application.

Care Kit laundry bags appear in the valuation catalogue, but no current inventory or referral form field maps to them. Their additions and distributions are therefore not captured automatically by the configured forms.

The supplied policy describes the listed item values, except socks and underwear, as weighted averages of “Better than Good” and “Excellent” condition; socks and underwear use “Excellent” only. The application uses the listed amounts directly; it does not calculate the weighted average. The source copy reviewed for this guide does not state the weighting percentages.

### Item and Inventory Values

The application calculates:

`Initial value = starting quantity × valuation per inventory unit`

`Current value = current count × valuation per inventory unit`

The dashboard does not calculate or display separate dollar totals for additions or subtractions. If a dollar equivalent is derived outside the dashboard, it would be the movement quantity multiplied by the valuation per inventory unit.

For bundle items, each inventory unit is one five-pair bundle and uses the five-pair bundle valuation above. A pack, kit, or backpack is valued as one pack, kit, or backpack. It is not expanded into its component items for dashboard counts or values.

## 9. Dashboard Summary Numbers

The dashboard shows the following figures for the selected year and location:

| Dashboard label | Meaning and calculation |
| --------------- | ----------------------- |
| Initial count | Sum of all opening quantities for the selected year and location. A missing opening record is treated as zero. |
| Items added | Sum of “in” inventory movements in the selected year and location. |
| Items distributed | Sum of all “out” movements in the selected year and location, including referrals and negative inventory-form adjustments. |
| Current count | Sum of each item's starting quantity plus additions minus subtractions. |
| Initial value | In the item table only: starting quantity multiplied by the selected year's valuation. |
| Current value | In the item table: current count multiplied by the selected year's valuation. In the summary: sum of all item current values, if every item has a valuation. |

The item table also shows “Quantity sub” and “Quantity added” per item. It does not show category subtotals, totals by both locations, an overall initial-value summary, or dollar totals for additions and distributions. The overall quantity totals combine all catalog units, including bundles, packs, kits, and individual items.

The “Items distributed” label is broader than referral distributions: it totals every removal direction, including recycling or other inventory-form deductions. The dashboard includes all catalog items in the selected view, even when their counts are zero.

## 10. Year and Location Filters

The dashboard offers the current calendar year and the four preceding years, and two locations: Lowcountry and Midlands. There is no “All Locations” selection.

The selected year controls the opening count, inventory movements, referrals, and item valuation. Inventory movements are included when their stored submission date falls within the selected UTC calendar year, from January 1 inclusive to January 1 of the following year exclusive. Time-zone-free Jotform submission times are interpreted as Eastern time first and then converted to UTC. As a result, a late-night Eastern submission near New Year's Eve can fall in the next UTC year.

The selected location filters opening counts and movements. Valuations are stored by item and year, not by location, so the selected year's valuation is the same for Lowcountry and Midlands.

For example, when a user selects 2026 and Lowcountry, the dashboard includes 2026 opening counts for Lowcountry and only movements assigned to Lowcountry whose stored dates fall in UTC 2026. It applies the 2026 valuations. Midlands activity and other years' activity are excluded.

## 11. Missing Valuations

When an item has no valuation for the selected year:

- Its initial and current monetary values are unavailable and the item table shows a hyphen (`-`), not `$0.00`.
- Its quantity calculations still work.
- The summary “Current value” is unavailable and displays a hyphen if any catalog item lacks a valuation. The dashboard displays a warning that the total value cannot be calculated.
- A zero valuation is different from a missing valuation: a valid zero is calculated and displayed as `$0.00`.

The item table does not show category subtotals. Therefore, the application does not present a partial total as though it were a complete valuation. The summary does not display an aggregate initial-value number.

## 12. Worked Example

**Fictional example only.** Assume the user selects 2026 and Lowcountry, and a category has a starting quantity of 20 men's tops, a $10.12 valuation per top, 10 tops added, and 5 tops removed through referrals.

| Step | Calculation | Result |
| ---- | ----------- | -----: |
| Starting men's tops | Opening count for 2026 / Lowcountry | 20 |
| Initial value | 20 × $10.12 | $202.40 |
| Additions | Included “in” movements | 10 |
| Referrals/removals | Included “out” movements | 5 |
| Current count | 20 + 10 − 5 | 25 |
| Current value | 25 × $10.12 | $253.00 |

Movements assigned to Midlands or to a different year are not included in this filtered result. If the 2026 men's-tops valuation were missing, the quantities would still be 20 added, 5 subtracted, and 25 current, but the initial and current monetary values would show as unavailable and the summary current value would also be unavailable.

## 13. Important Functions Explained in Plain Language

| Function or file | Plain-language purpose | Information it receives | Result it produces |
| ---------------- | ---------------------- | ----------------------- | ------------------ |
| [`normalizeReferralSubmission`](../lib/jotform/normalize-referral.ts) | Converts referral answers into the standard item categories and quantities used by inventory. | Form identity, item answers, type answers, age, and submission date. | Category-level item removals for the referral. |
| [`normalizeInventorySubmission`](../lib/jotform/normalize-inventory.ts) | Converts inventory-form quantities into additions or removals. | Form identity, item quantities, and submission date. | Item movements with a direction and positive quantity. |
| [`parseJotformSubmissionDate`](../lib/jotform/normalize-referral.ts) | Interprets time-zone-free form timestamps as Eastern time and converts them to a consistent date for reporting. | A submission timestamp. | A date stored and filtered in UTC. |
| [`importSubmissions`](../lib/jotform/import-submissions.ts) | Imports the four configured forms and applies the validation rules before saving. | Retrieved form submissions. | Newly saved records, skipped duplicate IDs, and reported failures. |
| [`valuationPerInventoryUnit`](../prisma/seed-data.ts) | Converts source prices into the value of one counted inventory unit, including multiplying pair prices by five for bundles. | The listed amount and any bundle multiplier. | A saved per-unit or per-bundle valuation. |
| [`queryInventoryRows`](../lib/inventory/get-inventory-query.ts) | Selects catalog items, opening counts, movements, and valuations for one year and location. | Selected year and location. | The starting quantity, additions, subtractions, and valuation for each item. |
| [`calculateRow`](../lib/inventory/calculate-row.ts) | Calculates one item's current quantity and monetary values. | Opening count, additions, subtractions, and valuation. | Initial/current counts and values for that item. |
| [`summarizeInventory`](../lib/inventory/summarize.ts) | Adds the item rows into the dashboard totals and marks value totals unavailable when a valuation is missing. | The calculated item rows. | Overall quantity and current-value summary. |
| [`getDashboard`](../lib/inventory/get-dashboard.ts) | Connects the selected data to the item-row and summary calculations. | Year and location. | The dashboard rows and totals. |
| [`normalizeSheetRow`](../lib/sheets/normalize-row.ts) | Converts an offline, header-based sheet row into the same inventory or referral format. | A mapped row and, if applicable, an explicit cancellation flag. | A normalized active submission or a cancelled record. |
| [`syncSubmission`](../lib/inventory/sync-submission.ts) | Updates activities for an explicitly supplied sheet record or removes activities for an explicitly supplied cancellation. | A normalized row and its submission ID. | A created, updated, unchanged, or cancelled record. This helper is not connected to a live sheet feed. |
| Inventory Editor (`components/inventory-editor.tsx`; edit API at `app/api/inventory/edit/route.ts`) | Lets an authorized user edit opening counts for a year/location or valuations for a year. Bundle valuation entry is per pair and the saved value is multiplied by five. | Selected year, location (for counts), and edited amounts. | Updated starting counts or yearly valuations. |

## 14. Reference Documents

| Reference | Repository path or availability | What it supports |
| --------- | ------------------------------- | ---------------- |
| Client inventory procedures and rule confirmations | Supplied in the project conversation; no repository file or approved link was provided. | Sorting and recording donations, annual physical counts, recycling deductions, care-kit contents, blankets, holiday items, and bundle units. |
| “List of Counted Items & IRS Valuation” and kit component lists | Supplied in the project conversation; no attached IRS valuation file was available. | Listed item amounts, unit descriptions, condition policy, and toiletry/backpack values. |
| Referral Data Spec | Not supplied as a separate document. | The form header-to-answer mappings currently used are visible in [`lib/sheets/mappings.ts`](../lib/sheets/mappings.ts); this is not a substitute for an approved complete Data Spec. |
| Referral Google Sheet and inventory sheets | No live sheet URL or spreadsheet ID is configured. Local CSV exports exist but are not linked here because they contain submission responses. | Current code mappings and offline row handling are in [`lib/sheets/mappings.ts`](../lib/sheets/mappings.ts) and [`lib/sheets/normalize-row.ts`](../lib/sheets/normalize-row.ts). |
| Actual starting-count source | Not supplied. [`examples/starting-inventory.example.json`](../examples/starting-inventory.example.json) is sample data only. | The expected import format is documented in [`scripts/import-starting-inventory.ts`](../scripts/import-starting-inventory.ts). |
| Referral mapping tests | [`tests/normalize-referral.test.mjs`](../tests/normalize-referral.test.mjs) and [`tests/normalize-sheet-row.test.mjs`](../tests/normalize-sheet-row.test.mjs). | Confirm referral quantities, type mappings, age cases, and offline sheet normalization. |
| Inventory movement tests | [`tests/normalize-inventory.test.mjs`](../tests/normalize-inventory.test.mjs) and [`tests/import-submissions.test.mjs`](../tests/import-submissions.test.mjs). | Confirm positive/negative quantities, blank/invalid handling, and submission-import validation. |
| Calculation and valuation tests | [`lib/inventory/calculate-row.test.mjs`](../lib/inventory/calculate-row.test.mjs), [`lib/inventory/summarize.test.mjs`](../lib/inventory/summarize.test.mjs), and [`tests/inventory-query.test.mjs`](../tests/inventory-query.test.mjs). | Confirm count/value formulas, filters, bundle valuation values, and missing-valuation behavior. |
| Inventory data structure | [`prisma/schema.prisma`](../prisma/schema.prisma). | Confirms that opening counts are by item/year/location, valuations by item/year, and movements store a positive quantity with a direction. |

## 15. Items Requiring Clarification

These items do not change the formulas above, but should be resolved or supported with approved records for a complete audit trail:

| Topic | Current application behavior and available evidence | Information needed / client question |
| ----- | ---------------------------------------------------- | ------------------------------------ |
| Starting-count evidence | The application stores starting counts by item, year, and location, but the actual source record was not supplied. | Please provide the approved physical-count sheet or other source and identify which year and location each opening count represents. |
| Source documents | The client procedure, quantity rules, and valuation tables were supplied in the conversation, but the Data Spec, quantity PDF, meeting-notes file, and IRS valuation sheet were not available as repository files or approved links. | Please provide the final versions or approved links so an auditor can reference the source documents directly. |
| Valuation year and weighted-average support | The code seeds the listed values for 2026 by default. The provided valuation list has no effective year or weighted-average percentages; the application uses the listed amounts directly. | Please confirm the effective year of the valuation list and provide the condition weights or confirm that the published dollar amounts alone are the approved basis. |
| School-uniform sizes | The client note says uniform sizes match the corresponding tops and bottoms. The application tracks only the category and fixed quantity; it does not store or compare sizes. | If size-level audit reporting is required, should the referral and inventory forms be changed to capture sizes separately? |
| Shoe inventory unit | A referral removes one shoe inventory unit, described in the client quantity table as one pair. The inventory form accepts a numeric shoe quantity and applies no conversion. | Please confirm that inventory-form shoe quantities are entered as pairs rather than individual shoes. |
| Care Kit laundry bags | The item has a catalogue valuation but no current inventory or referral form mapping. | Should laundry bags be tracked in inventory and distributed in care kits? If so, which form answer and quantity should control them? |
| Live bundle valuations | The code's reference values now multiply the listed sock and underwear pair amounts by five, but the live database was not inspected. | Before using live balances for an audit, please verify that the saved valuations for the selected year reflect the five-pair bundle values. |
| Historical submissions | Only the four current forms are configured in the application; historical forms and actual historical records were not supplied for review. | Please provide the historical forms and identify the years and locations that should be imported before treating earlier dashboard years as complete. |
| Book reading levels | The client procedure sorts books into reading-level bins, while the application has one combined Books category and does not record reading level. | Please confirm whether reading-level counts are needed in the dashboard or audit output. |
| Spreadsheet edits and cancellations | Re-importing an already-saved Jotform ID skips it. The offline sheet helper needs an explicit cancellation flag; it does not read yellow cell formatting, and no live sheet connection is configured. | Until live synchronization is separately implemented, what approved manual process should staff use to correct or cancel a submission already reflected in the dashboard? |

The blanket policy difference is documented in Section 3: the written procedure says blankets are not counted, but the client directed that the current application behavior remain unchanged. The application therefore counts a submitted blanket inventory quantity and has no referral-based blanket deduction.
