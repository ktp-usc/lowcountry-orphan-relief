import { createHash } from "node:crypto";

export type JotformSubmission = {
  id: string;
  form_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
};

export type InvalidSubmissionIssue = {
  formId: string;
  /** "unknown" when no valid string ID was supplied. */
  submissionId: string;
  /** Zero-based position in the API result, including pagination offset. */
  recordIndex: number;
  reason: "not-an-object" | "invalid-id" | "wrong-form" | "invalid-created-at" | "invalid-updated-at" | "invalid-answers";
};

export type FetchSubmissionsOptions = {
  /** Jotform supports at most 1,000 submissions per request. */
  pageSize?: number;
  /** Timeout for each request, including reading its response body. */
  timeoutMs?: number;
  /** Stop after this many records, including reported malformed entries. */
  maxSubmissions?: number;
  /** Report and skip malformed records instead of rejecting the whole form. */
  onInvalidSubmission?: (issue: InvalidSubmissionIssue) => void;
};

const apiOrigins = [
  "https://api.jotform.com",
  "https://eu-api.jotform.com",
  "https://hipaa-api.jotform.com",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidReason(entry: unknown, formId: string): InvalidSubmissionIssue["reason"] | undefined {
  if (!isObject(entry)) return "not-an-object";
  if (typeof entry.id !== "string" || !/^\d+$/.test(entry.id)) return "invalid-id";
  if (entry.form_id !== formId) return "wrong-form";
  if (entry.created_at !== undefined && entry.created_at !== null && typeof entry.created_at !== "string") return "invalid-created-at";
  if (entry.updated_at !== undefined && entry.updated_at !== null && typeof entry.updated_at !== "string") return "invalid-updated-at";
  if (entry.answers !== undefined && entry.answers !== null && !isObject(entry.answers)) return "invalid-answers";
  return undefined;
}

function recordIdentity(entry: unknown): string | undefined {
  if (!isObject(entry) || typeof entry.id !== "string" || !/^\d+$/.test(entry.id)) return undefined;
  // Include the payload's form ID: a wrong-form record must not hide a later,
  // valid record with the same submission ID from the requested form.
  const sourceFormId = typeof entry.form_id === "string" && /^\d+$/.test(entry.form_id) ? entry.form_id : "invalid-form";
  return `${sourceFormId}/${entry.id}`;
}

function statusHint(status: number): string {
  switch (status) {
    case 401: return "Check JOTFORM_API_KEY.";
    case 403: return "Check that the API key has permission to read this form.";
    case 404: return "Check the form ID and Jotform API region.";
    case 429: return "The Jotform API limit was reached; try again later.";
    default: return "Try again later or check Jotform service availability.";
  }
}

/**
 * Fetch raw submissions on the server. Next.js loads .env automatically;
 * standalone callers must load it before calling this function.
 * Strict by default. With onInvalidSubmission, invalid individual records are
 * reported and skipped; they count toward maxSubmissions. Transport/envelope
 * failures still reject rather than returning partial data. No answers,
 * response bodies, or keys are logged or included in issue notifications.
 */
export async function fetchSubmissions(
  formId: string,
  { pageSize = 1_000, timeoutMs = 30_000, maxSubmissions, onInvalidSubmission }: FetchSubmissionsOptions = {},
): Promise<JotformSubmission[]> {
  if (typeof window !== "undefined") {
    throw new Error("fetchSubmissions must run on the server.");
  }
  if (typeof formId !== "string" || !/^\d+$/.test(formId.trim())) {
    throw new Error("Provide the Jotform form ID as a numeric string.");
  }
  formId = formId.trim();
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("pageSize must be an integer between 1 and 1000.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("timeoutMs must be a positive integer no larger than 2147483647.");
  }
  if (maxSubmissions !== undefined && (!Number.isSafeInteger(maxSubmissions) || maxSubmissions < 1)) {
    throw new Error("maxSubmissions must be a positive safe integer.");
  }
  if (onInvalidSubmission !== undefined && typeof onInvalidSubmission !== "function") {
    throw new Error("onInvalidSubmission must be a function.");
  }

  const apiKey = process.env.JOTFORM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set JOTFORM_API_KEY in .env before fetching submissions.");
  }
  const origin = (process.env.JOTFORM_API_BASE_URL?.trim() || apiOrigins[0]).replace(/\/$/, "");
  if (!apiOrigins.includes(origin)) {
    throw new Error("JOTFORM_API_BASE_URL must be a standard, EU, or HIPAA Jotform API URL.");
  }

  const submissions: JotformSubmission[] = [];
  const seenRecords = new Set<string>();
  const unidentifiedPages = new Set<string>();
  let handled = 0;
  let offset = 0;

  while (true) {
    const fail = (message: string) => new Error(`Jotform form ${formId}, offset ${offset}: ${message}`);
    const url = new URL(`/form/${formId}/submissions`, origin);
    const remaining = maxSubmissions === undefined ? pageSize : maxSubmissions - handled;
    url.searchParams.set("limit", String(Math.min(pageSize, remaining)));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("orderby", "id");
    const signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { APIKEY: apiKey, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch {
      throw fail(signal.aborted
        ? `Request timed out after ${timeoutMs} ms.`
        : "Request failed; check network access and the Jotform API region.");
    }
    if (!response.ok) {
      throw fail(`HTTP ${response.status}. ${statusHint(response.status)}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw fail(signal.aborted
        ? `Request timed out after ${timeoutMs} ms.`
        : "Jotform returned invalid JSON.");
    }
    if (!isObject(body) || typeof body.responseCode !== "number") {
      throw fail("Jotform returned an invalid response envelope.");
    }
    if (body.responseCode !== 200) {
      throw fail(`API response code ${body.responseCode}. ${statusHint(body.responseCode)}`);
    }
    if (!Array.isArray(body.content)) {
      throw fail("Jotform returned a non-array submissions payload.");
    }
    if (body.content.length === 0) return submissions;

    if (onInvalidSubmission && body.content.some((entry: unknown) => !recordIdentity(entry))) {
      // Without an ID, deduplication cannot detect a server repeating a page.
      // Retain only a digest; do not retain or emit malformed answer payloads.
      const digest = createHash("sha256").update(JSON.stringify(body.content)).digest("hex");
      if (unidentifiedPages.has(digest)) throw fail("Pagination made no progress; Jotform repeated an unidentifiable page.");
      unidentifiedPages.add(digest);
    }
    const page: JotformSubmission[] = [];
    let pageProgress = 0;
    for (const [index, entry] of body.content.entries()) {
      const reason = invalidReason(entry, formId);
      if (reason && !onInvalidSubmission) {
        throw fail("Jotform returned an invalid submission or a submission from another form.");
      }
      const identity = recordIdentity(entry);
      if (identity && seenRecords.has(identity)) continue;
      if (identity) seenRecords.add(identity);
      handled++;
      pageProgress++;
      if (reason) {
        const submissionId = isObject(entry) && typeof entry.id === "string" && /^\d+$/.test(entry.id) ? entry.id : "unknown";
        onInvalidSubmission!({ formId, submissionId, recordIndex: offset + index, reason });
      } else {
        page.push(entry as JotformSubmission);
      }
      if (maxSubmissions !== undefined && handled === maxSubmissions) {
        return [...submissions, ...page];
      }
    }
    if (pageProgress === 0) {
      throw fail("Pagination made no progress; Jotform returned only previously fetched submissions.");
    }
    submissions.push(...page);
    // Advance by the actual batch size, including overlaps. Do not assume a
    // short batch is the last one or treat resultSet.count as a grand total.
    offset += body.content.length;
  }
}
