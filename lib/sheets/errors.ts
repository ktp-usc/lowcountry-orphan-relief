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

/** Never include Google's response body, request headers, or underlying errors. */
export async function requestJson(request: typeof fetch, url: string, init: RequestInit, label: string): Promise<unknown> {
  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await request(url, { ...init, signal, redirect: "error", cache: "no-store" });
  } catch {
    throw new SheetReadError(`${label}: ${signal.aborted ? "request timed out" : "request failed"}.`);
  }
  if (!response.ok) {
    const hint = response.status === 403 ? " Check API access and Viewer sharing with the service account."
      : response.status === 401 ? " Check the service-account credentials."
      : response.status === 404 ? " Check the spreadsheet ID and service-account sharing."
      : response.status === 429 ? " Google request quota reached; retry later." : "";
    throw new SheetReadError(`${label}: HTTP ${response.status}.${hint}`);
  }
  try {
    return await response.json();
  } catch {
    throw new SheetReadError(`${label}: ${signal.aborted ? "request timed out" : "invalid JSON response"}.`);
  }
}
