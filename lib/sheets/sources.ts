import type { SheetSource } from "./types.js";

/** Spreadsheet IDs from the Resources section of the client project plan.
 * The supplied links omit gid. -1 deliberately blocks reads until the actual
 * tab IDs are verified; 0 would silently assume a particular tab.
 * Empty date headers also require verification against the live header row.
 */
export const SHEET_SOURCES: readonly SheetSource[] = [
  {
    key: "lor-inventory", spreadsheetId: "1Xb92CED0YS0wHgd5a1jBKHTYrkZaA6gP", tabId: -1,
    jotformFormId: "241895593214161", location: "LOWCOUNTRY", sourceType: "INVENTORY",
    submissionIdHeader: "Submission ID", submissionDateHeader: "",
  },
  {
    key: "mor-inventory", spreadsheetId: "1oa7mA59lDbmHNvf--z0lqd0U7chx6Bmh", tabId: -1,
    jotformFormId: "250054265404145", location: "MIDLANDS", sourceType: "INVENTORY",
    submissionIdHeader: "Submission ID", submissionDateHeader: "",
  },
  {
    key: "lor-referral", spreadsheetId: "1cNks4g6h9UIO_OekcnEdt_TfBrtz0mLx", tabId: -1,
    jotformFormId: "261498369429070", location: "LOWCOUNTRY", sourceType: "REFERRAL",
    submissionIdHeader: "Submission ID", submissionDateHeader: "",
  },
  {
    key: "mor-referral", spreadsheetId: "14m2U-YXLsnUcQTRIXhzOtbwlT7Wjq5Wh", tabId: -1,
    jotformFormId: "261526295444158", location: "MIDLANDS", sourceType: "REFERRAL",
    // The separate named Date column was identified in the ticket. Its meaning
    // still needs confirmation; the unlabeled first column is never a fallback.
    submissionIdHeader: "Submission ID", submissionDateHeader: "Date",
  },
];

/** Set only after checking the Submission ID fill on a real cancelled referral.
 * Sample tests use #ffff00, which is not evidence of the client's actual color.
 */
export const REFERRAL_CANCELLATION_YELLOW: string | null = null;
