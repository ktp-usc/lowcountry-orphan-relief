import { JOTFORM_FORMS } from "../jotform/forms.js";
import type { ColumnReference, SheetSource } from "./types.js";

const column = (header: string): ColumnReference => ({ header });
const inventoryAnswers = Object.fromEntries(Object.entries({
  "8": "Men's Tops", "70": "Men's Bottoms", "79": "Men's Jackets", "82": "Men's Pajamas",
  "85": "Men's Socks", "88": "Men's Underwear", "91": "Men's Shoes",
  "94": "Women's Tops", "97": "Women's Bottoms", "106": "Women's Dresses",
  "121": "Women's Jackets", "109": "Women's Pajamas", "112": "Women's Socks",
  "115": "Women's Underwear", "118": "Women's Shoes", "124": "Children's Tops",
  "127": "Children's Bottoms", "136": "Children's Dresses", "139": "Children's Jackets",
  "142": "Children's Pajamas", "145": "Children's Socks", "148": "Children's Underwear",
  "151": "Children's Shoes", "49": "Diapers", "50": "Pull-Ups", "51": "Wipes",
  "52": "Stuffed Animals", "53": "Books", "54": "Blanket", "61": "0-5", "62": "6-11",
  "63": "12-18", "64": "Elementary School Bookbag & Supplies", "65": "Middle/High School Bookbag & Supplies",
}).map(([id, header]) => [id, column(header)]));

const referralAnswers = Object.fromEntries(Object.entries({
  "88": "Tops?", "90": "Male Tops Type", "93": "Female Tops Type",
  "103": "Bottoms?", "104": "Male Bottoms Type", "105": "Female Bottoms Type",
  "110": "Jackets?", "111": "Male Jackets Type", "112": "Female Jackets Type",
  "117": "Dresses?", "119": "Female Dresses Type", "126": "Pajamas?",
  "127": "Male Pajamas Type", "128": "Female Pajamas Type",
  "133": "Underwear?", "134": "Male Underwear Type", "135": "Female Underwear Type",
  "140": "Shoes?", "141": "Male Shoes Type", "142": "Female Shoes Type",
  "147": "Socks?", "81": "Wipes", "85": "Toiletries",
  "159": "Diapers or Pullups?", "83": "School", "169": "School Uniform Tops",
  "171": "School Uniform Bottoms",
}).map(([id, header]) => [id, column(header)]));

const common = { submissionId: column("Submission ID"), cancellation: null } as const;

export const SHEET_SOURCES: readonly SheetSource[] = [
  { ...common, ...{ jotformFormId: JOTFORM_FORMS[0].id, location: JOTFORM_FORMS[0].location, sourceType: JOTFORM_FORMS[0].sourceType },
    key: "lor-inventory", fileName: "LOR Inventory Quantity.xlsx - Form responses.csv",
    submissionDate: column("Submission Date"), answers: inventoryAnswers },
  { ...common, ...{ jotformFormId: JOTFORM_FORMS[1].id, location: JOTFORM_FORMS[1].location, sourceType: JOTFORM_FORMS[1].sourceType },
    key: "mor-inventory", fileName: "MOR Inventory Quantity.xlsx - Form responses.csv",
    submissionDate: column("Submission Date"), answers: inventoryAnswers },
  { ...common, ...{ jotformFormId: JOTFORM_FORMS[2].id, location: JOTFORM_FORMS[2].location, sourceType: JOTFORM_FORMS[2].sourceType },
    key: "lor-referral", fileName: "Copy of Lowcountry Orphan Relief Referral Form 3.0.xlsx - Form responses.csv",
    submissionDate: column("Submission Date"), answers: referralAnswers },
  { ...common, ...{ jotformFormId: JOTFORM_FORMS[3].id, location: JOTFORM_FORMS[3].location, sourceType: JOTFORM_FORMS[3].sourceType },
    key: "mor-referral", fileName: "Copy of Midlands Orphan Relief Referral Form 3.0.xlsx - Form responses.csv",
    // Same first-column layout as LOR; all 471 nonblank cells use the submission-timestamp format.
    submissionDate: { index: 0, expectedHeader: " " }, answers: referralAnswers },
];
