export type JotformForm = {
  id: string;
  location: "LOWCOUNTRY" | "MIDLANDS";
  sourceType: "INVENTORY" | "REFERRAL";
};

/** The four approved forms; this list controls fetching and normalizer choice. */
export const JOTFORM_FORMS = [
  { id: "241895593214161", location: "LOWCOUNTRY", sourceType: "INVENTORY" },
  { id: "250054265404145", location: "MIDLANDS", sourceType: "INVENTORY" },
  { id: "261498369429070", location: "LOWCOUNTRY", sourceType: "REFERRAL" },
  { id: "261526295444158", location: "MIDLANDS", sourceType: "REFERRAL" },
] as const satisfies readonly JotformForm[];
