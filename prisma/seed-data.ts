export type ItemValuationSeed = {
  code: string;
  displayName: string;
  /** Exact USD price for the listed unit, rather than a per-piece conversion. */
  valuePerUnit: string;
  /** Source columns retained for the future Jotform normalizer. */
  unit: "Per Pack" | "Each" | "Per Kit" | "Per BP";
  quantity: number;
};

// Transcribed from the supplied "List of Counted Items & IRS Valuation" table,
// page 3 of the inventory-management policy. The source has no visible year.
// Prices apply to the source's Unit column. In particular, diapers and pull-ups
// cost $7.25 per pack of 30, not $7.25 per individual diaper/pull-up.
// Unit/Qty remain reference metadata here; the existing database schema stores
// the category and its quoted price. Activity quantities must use those units.
export const itemValuations: readonly ItemValuationSeed[] = [
  { code: "DIAPERS", displayName: "Diapers", valuePerUnit: "7.25", unit: "Per Pack", quantity: 30 },
  { code: "PULL_UPS", displayName: "Pull-Ups", valuePerUnit: "7.25", unit: "Per Pack", quantity: 30 },
  { code: "WIPES", displayName: "Wipes", valuePerUnit: "2.50", unit: "Per Pack", quantity: 1 },
  { code: "STUFFED_ANIMALS", displayName: "Stuffed Animals", valuePerUnit: "9.25", unit: "Each", quantity: 1 },
  { code: "BOOKS", displayName: "Books", valuePerUnit: "0.75", unit: "Each", quantity: 1 },
  { code: "BABY_BLANKET", displayName: "Baby Blanket", valuePerUnit: "5.53", unit: "Each", quantity: 1 },
  { code: "CARE_KIT_LAUNDRY_BAGS", displayName: "Care Kit Laundry Bags", valuePerUnit: "3.98", unit: "Each", quantity: 1 },
  { code: "MENS_TOPS", displayName: "Men's Tops (Shirts, Sweaters & Sweatshirts)", valuePerUnit: "10.12", unit: "Each", quantity: 1 },
  { code: "MENS_BOTTOMS", displayName: "Men's Bottoms (Shorts, Pants & Sweatpants)", valuePerUnit: "8.80", unit: "Each", quantity: 1 },
  { code: "MENS_JACKETS_HOODIES", displayName: "Men's Jackets & Hoodies", valuePerUnit: "21.67", unit: "Each", quantity: 1 },
  { code: "MENS_PAJAMAS", displayName: "Men's Pajamas", valuePerUnit: "6.83", unit: "Each", quantity: 1 },
  { code: "MENS_SOCKS", displayName: "Men's Socks", valuePerUnit: "3.00", unit: "Each", quantity: 1 },
  { code: "MENS_UNDERWEAR", displayName: "Men's Underwear", valuePerUnit: "3.15", unit: "Each", quantity: 1 },
  { code: "MENS_SHOES", displayName: "Men's Shoes", valuePerUnit: "20.74", unit: "Each", quantity: 1 },
  { code: "WOMENS_TOPS", displayName: "Women's Tops", valuePerUnit: "10.15", unit: "Each", quantity: 1 },
  { code: "WOMENS_BOTTOMS", displayName: "Women's Bottoms", valuePerUnit: "10.25", unit: "Each", quantity: 1 },
  { code: "WOMENS_DRESSES", displayName: "Women's Dresses", valuePerUnit: "16.03", unit: "Each", quantity: 1 },
  { code: "WOMENS_JACKETS_HOODIES", displayName: "Women's Jackets & Hoodies", valuePerUnit: "10.50", unit: "Each", quantity: 1 },
  { code: "WOMENS_PAJAMAS", displayName: "Women's Pajamas", valuePerUnit: "10.50", unit: "Each", quantity: 1 },
  { code: "WOMENS_SOCKS", displayName: "Women's Socks", valuePerUnit: "1.35", unit: "Each", quantity: 1 },
  { code: "WOMENS_UNDERWEAR", displayName: "Women's Underwear", valuePerUnit: "3.15", unit: "Each", quantity: 1 },
  { code: "WOMENS_SHOES", displayName: "Women's Shoes", valuePerUnit: "20.22", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_TOPS", displayName: "Children's Tops", valuePerUnit: "6.33", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_BOTTOMS", displayName: "Children's Bottoms", valuePerUnit: "8.03", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_DRESSES", displayName: "Children's Dresses", valuePerUnit: "10.38", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_JACKETS_HOODIES", displayName: "Children's Jackets & Hoodies", valuePerUnit: "20.48", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_PAJAMAS", displayName: "Children's Pajamas", valuePerUnit: "5.48", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_SOCKS", displayName: "Children's Socks", valuePerUnit: "1.60", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_UNDERWEAR", displayName: "Children's Underwear", valuePerUnit: "3.70", unit: "Each", quantity: 1 },
  { code: "CHILDRENS_SHOES", displayName: "Children's Shoes", valuePerUnit: "7.57", unit: "Each", quantity: 1 },
  { code: "TOILETRY_KIT_0_5_YRS", displayName: "Toiletry Kit 0-5 yrs", valuePerUnit: "5.60", unit: "Per Kit", quantity: 1 },
  { code: "TOILETRY_KIT_6_11_YRS", displayName: "Toiletry Kit 6-11 yrs", valuePerUnit: "10.50", unit: "Per Kit", quantity: 1 },
  { code: "TOILETRY_KIT_12_18_YRS", displayName: "Toiletry Kit 12-18 yrs", valuePerUnit: "11.80", unit: "Per Kit", quantity: 1 },
  { code: "ELEMENTARY_SCHOOL_BOOKBAG_SUPPLIES", displayName: "Elementary School Bookbag & Supplies", valuePerUnit: "52.63", unit: "Per BP", quantity: 1 },
  { code: "MIDDLE_HIGH_SCHOOL_BOOKBAG_SUPPLIES", displayName: "Middle/High School Bookbag & Supplies", valuePerUnit: "60.22", unit: "Per BP", quantity: 1 },
];
