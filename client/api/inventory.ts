import { fetchJson } from "@/client/api/jsonutils";
import type { DashboardData } from "@/lib/inventory/get-dashboard";

export function fetchDashboard(year: string, location: string) {
  const params = new URLSearchParams({ year, location });
  return fetchJson<DashboardData>(`/api/inventory?${params.toString()}`);
}