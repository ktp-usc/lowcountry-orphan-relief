export type JotformSubmission = {
  id: string;
  form_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FetchSubmissionsOptions = {
  /** Jotform supports at most 1,000 submissions per request. */
  pageSize?: number;
  /** Timeout for each request, including reading its response body. */
  timeoutMs?: number;
};

const apiOrigins = [
  "https://api.jotform.com",
  "https://eu-api.jotform.com",
  "https://hipaa-api.jotform.com",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
 * Returns [] only after a successful empty response. Failures reject rather
 * than returning partial data. No answers, response bodies, or keys are logged.
 */
export async function fetchSubmissions(
  formId: string,
  { pageSize = 1_000, timeoutMs = 30_000 }: FetchSubmissionsOptions = {},
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

  const apiKey = process.env.JOTFORM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set JOTFORM_API_KEY in .env before fetching submissions.");
  }
  const origin = (process.env.JOTFORM_API_BASE_URL?.trim() || apiOrigins[0]).replace(/\/$/, "");
  if (!apiOrigins.includes(origin)) {
    throw new Error("JOTFORM_API_BASE_URL must be a standard, EU, or HIPAA Jotform API URL.");
  }

  const submissions: JotformSubmission[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  while (true) {
    const fail = (message: string) => new Error(`Jotform form ${formId}, offset ${offset}: ${message}`);
    const url = new URL(`/form/${formId}/submissions`, origin);
    url.searchParams.set("limit", String(pageSize));
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

    const page: JotformSubmission[] = [];
    for (const entry of body.content) {
      if (!isObject(entry) || typeof entry.id !== "string" || !/^\d+$/.test(entry.id)
        || entry.form_id !== formId
        || (entry.created_at !== undefined && entry.created_at !== null && typeof entry.created_at !== "string")) {
        throw fail("Jotform returned an invalid submission or a submission from another form.");
      }
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        page.push(entry as JotformSubmission);
      }
    }
    if (page.length === 0) {
      throw fail("Pagination made no progress; Jotform returned only previously fetched submissions.");
    }
    submissions.push(...page);
    // Advance by the actual batch size, including overlaps. Do not assume a
    // short batch is the last one or treat resultSet.count as a grand total.
    offset += body.content.length;
  }
}
