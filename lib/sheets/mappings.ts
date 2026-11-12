import { JOTFORM_FORMS } from "../jotform/forms.js";
import type { SheetSource } from "./types.js";

export type SheetMapping = SheetSource & {
  fileName: string;
  answerHeaders: Readonly<Record<string, string>>;
};

const inventoryAnswerHeaders: Readonly<Record<string, string>> = {
  "8": "Men's Tops", "70": "Men's Bottoms", "79": "Men's Jackets", "82": "Men's Pajamas",
  "85": "Men's Socks", "88": "Men's Underwear", "91": "Men's Shoes",
  "94": "Women's Tops", "97": "Women's Bottoms", "106": "Women's Dresses",
  "121": "Women's Jackets", "109": "Women's Pajamas", "112": "Women's Socks",
  "115": "Women's Underwear", "118": "Women's Shoes", "124": "Children's Tops",
  "127": "Children's Bottoms", "136": "Children's Dresses", "139": "Children's Jackets",
  "142": "Children's Pajamas", "145": "Children's Socks", "148": "Children's Underwear",
  "151": "Children's Shoes", "49": "Diapers", "50": "Pull-Ups", "51": "Wipes",
  "52": "Stuffed Animals", "53": "Books", "54": "Blanket", "61": "0-5", "62": "6-11",
  "63": "12-18", "64": "Elementary School Bookbag & Supplies",
  "65": "Middle/High School Bookbag & Supplies",
};

const referralAnswerHeaders: Readonly<Record<string, string>> = {
  "17": "Child's Sex", "158": "Childs Age",
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
};

const source = (
  formIndex: number,
  key: string,
  fileName: string,
  answerHeaders: Readonly<Record<string, string>>,
): SheetMapping => {
  const form = JOTFORM_FORMS[formIndex];
  return {
    key,
    spreadsheetId: "",
    tabId: 0,
    jotformFormId: form.id,
    location: form.location,
    sourceType: form.sourceType,
    submissionIdHeader: "Submission ID",
    submissionDateHeader: "Submission Date",
    fileName,
    answerHeaders,
  };
};

export const SHEET_MAPPINGS: readonly SheetMapping[] = [
  source(0, "lor-inventory", "LOR Inventory Quantity.xlsx - Form responses.csv", inventoryAnswerHeaders),
  source(1, "mor-inventory", "MOR Inventory Quantity.xlsx - Form responses.csv", inventoryAnswerHeaders),
  source(2, "lor-referral", "Copy of Lowcountry Orphan Relief Referral Form 3.0.xlsx - Form responses.csv", referralAnswerHeaders),
  source(3, "mor-referral", "Copy of Midlands Orphan Relief Referral Form 3.0.xlsx - Form responses.csv", referralAnswerHeaders),
];
