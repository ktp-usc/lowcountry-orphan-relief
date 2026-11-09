import type { DashboardData } from "@/lib/inventory/get-dashboard";

export class DashboardApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchDashboard(
  year: string,
  location: string,
): Promise<DashboardData> {
  const params = new URLSearchParams({ year, location });
  const res = await fetch(`/api/inventory?${params.toString()}`);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new DashboardApiError(
      json?.error ?? `request_failed_${res.status}`,
      res.status,
      json?.code,
    );
  }

  return json.data as DashboardData;
}