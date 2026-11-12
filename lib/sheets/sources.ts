import type { SheetSource } from "./types.js";

export const SHEET_SOURCES: readonly SheetSource[] = [
  {
    key: "lor-inventory", spreadsheetId: "1wBOD_fPH7oei5zEfktdFt_-OCZGgsO9eqWCjmbMh-2E", tabId: 1993480790,
    jotformFormId: "241895593214161", location: "LOWCOUNTRY", sourceType: "INVENTORY",
    submissionIdHeader: "Submission ID", submissionDateHeader: "Submission Date",
  },
  {
    key: "mor-inventory", spreadsheetId: "1dGDtxcFvryt0zE-6K9pVI0ZXCYQOwu-RALePOvATrF0", tabId: 51238458,
    jotformFormId: "250054265404145", location: "MIDLANDS", sourceType: "INVENTORY",
    submissionIdHeader: "Submission ID", submissionDateHeader: "Submission Date",
  },
  {
    key: "lor-referral", spreadsheetId: "1su1FCelCAoNnf5auudF_SmU30wLesNFIrmK7dZ-itIg", tabId: 1761833122,
    jotformFormId: "261498369429070", location: "LOWCOUNTRY", sourceType: "REFERRAL",
    submissionIdHeader: "Submission ID", submissionDateHeader: "Submission Date",
  },
  {
    key: "mor-referral", spreadsheetId: "16UsDpGbgJTIOXB9czKf03tMnIohDIeoIrLFXc4lGLns", tabId: 493112246,
    jotformFormId: "261526295444158", location: "MIDLANDS", sourceType: "REFERRAL",
    submissionIdHeader: "Submission ID", submissionDateHeader: "Submission Date",
  },
];

export const REFERRAL_CANCELLATION_YELLOW: string | null = "#ffff00";
