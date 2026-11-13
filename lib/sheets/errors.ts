/** Only fixed descriptions and column/row metadata belong in reader errors. */
export class SheetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetReadError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertReadDeadline(deadlineMs?: number): void {
  if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
    throw new SheetReadError("Sheet sync deadline reached; this read is incomplete.");
  }
}

/** Also bounds cached authentication promises and response-body/retry waits. */
export async function withReadDeadline<T>(operation: () => Promise<T>, deadlineMs?: number): Promise<T> {
  assertReadDeadline(deadlineMs);
  if (deadlineMs === undefined) return operation();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SheetReadError("Sheet sync deadline reached; this read is incomplete.")),
          Math.max(1, Math.min(2_147_483_647, Math.ceil(deadlineMs - Date.now()))));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Never include Google's response body, request headers, or underlying errors. */
export async function requestJson(
  request: typeof fetch, url: string, init: RequestInit, label: string,
  retry: { sleep?: (ms: number) => Promise<void>; random?: () => number; deadlineMs?: number } = {},
): Promise<unknown> {
  return withReadDeadline(async () => {
    const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
      assertReadDeadline(retry.deadlineMs);
      const remaining = retry.deadlineMs === undefined ? 30_000 : retry.deadlineMs - Date.now();
      const signal = AbortSignal.timeout(Math.max(1, Math.min(30_000, Math.ceil(remaining))));
      let response: Response;
      try {
        response = await request(url, { ...init, signal, redirect: "error", cache: "no-store" });
      } catch {
        assertReadDeadline(retry.deadlineMs);
        throw new SheetReadError(`${label}: ${signal.aborted ? "request timed out" : "request failed"}.`);
      }
      assertReadDeadline(retry.deadlineMs);
      // Retry only read-only Sheet requests, never writes. Honor short Retry-After
      // values, but fail safely rather than sleeping past the execution budget.
      if (label === "Google Sheets read" && [429, 503].includes(response.status) && attempt < 2) {
        const header = response.headers.get("retry-after");
        const seconds = header === null ? undefined : /^\d+$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000);
        const delay = seconds !== undefined && Number.isFinite(seconds)
          ? seconds * 1000 : 1000 * 2 ** attempt + Math.floor((retry.random ?? Math.random)() * 250);
        if (delay <= 10_000) {
          if (retry.deadlineMs !== undefined && Date.now() + delay >= retry.deadlineMs) {
            throw new SheetReadError("Sheet sync deadline reached; this read is incomplete.");
          }
          await response.body?.cancel();
          await sleep(delay);
          continue;
        }
      }
      if (!response.ok) {
        const hint = response.status === 403 ? " Check API access and Viewer sharing with the service account."
          : response.status === 401 ? " Check the service-account credentials."
          : response.status === 404 ? " Check the spreadsheet ID and service-account sharing."
          : response.status === 429 ? " Google request quota reached; retry later." : "";
        throw new SheetReadError(`${label}: HTTP ${response.status}.${hint}`);
      }
      try {
        const body = await response.json();
        assertReadDeadline(retry.deadlineMs);
        return body;
      } catch {
        assertReadDeadline(retry.deadlineMs);
        throw new SheetReadError(`${label}: ${signal.aborted ? "request timed out" : "invalid JSON response"}.`);
      }
    }
  }, retry.deadlineMs);
}
