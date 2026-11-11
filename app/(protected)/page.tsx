"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { DashboardApiError, fetchDashboard } from "@/client/api/inventory";
import { qk } from "@/client/queries/keys";
import { DashboardFilters } from "@/components/DashboardFilters";
import InventorySummary from "@/components/inventory-summary";
import InventoryTable from "@/components/inventory-table";
import { SignOutButton } from "@/components/sign-out-button";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function Home() {
  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear())
  );
  const [selectedLocation, setSelectedLocation] = useState("LOWCOUNTRY");
  const router = useRouter();
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.dashboard(selectedYear, selectedLocation),
    queryFn: () => fetchDashboard(selectedYear, selectedLocation),
    gcTime: 0, // don't keep old results, so every change shows loading
    // Retrying can't fix these, so fail fast
    retry: (failureCount, err) =>
      !(
        err instanceof DashboardApiError &&
        [401, 403, 422].includes(err.status)
      ) && failureCount < 3,
  });

    // A signed-out (or no-longer-allowed) user gets sent back to sign in
  const unauthorizedStatus =
    error instanceof DashboardApiError &&
    (error.status === 401 || error.status === 403)
      ? error.status
      : null;

  useEffect(() => {
    if (unauthorizedStatus === 401) router.replace("/sign-in");
    if (unauthorizedStatus === 403) router.replace("/sign-in?error=not_allowed");
  }, [unauthorizedStatus, router]);

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  const hasMissingValuations = rows.some(
    (row) => row.initialValue === null || row.currentValue === null
  );

  const summaryMetrics = summary
    ? [
        { id: "initial-count", label: "Initial count", value: summary.totalInitialCount },
        { id: "incoming", label: "Items added", value: summary.totalItemsAdded },
        { id: "outgoing", label: "Items distributed", value: summary.totalItemsSubtracted },
        { id: "current-count", label: "Current count", value: summary.totalCurrentCount, emphasized: true },
        {
          id: "current-value",
          label: "Current value",
          value:
            summary.totalCurrentValue === null
              ? null
              : currency.format(summary.totalCurrentValue),
          emphasized: true,
        },
      ]
    : [];

  // The table uses slightly different field names than the inventory library
  const tableRows = rows.map((row) => ({
    item: row.itemName,
    initialCount: row.initialCount,
    initialValue: row.initialValue,
    itemsSubtracted: row.itemsSubtracted,
    itemsAdded: row.itemsAdded,
    currentCount: row.currentCount,
    currentValue: row.currentValue,
  }));

  return (
    <main className="min-h-screen bg-background px-6 py-8 md:px-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Lowcountry Orphan Relief Inventory
        </h1>
        <SignOutButton />
      </header>

      <section className="mb-6">
        <DashboardFilters
          selectedYear={selectedYear}
          selectedLocation={selectedLocation}
          onYearChange={setSelectedYear}
          onLocationChange={setSelectedLocation}
        />
      </section>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading inventory...</p>
      ) : unauthorizedStatus ? (
        <p className="text-sm text-muted-foreground">
          Redirecting to sign in...
        </p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load inventory: {error.message}
        </p>
      ) : (
        <>
          {hasMissingValuations && (
            <p
              role="status"
              className="mb-6 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground"
            >
              Some items are missing a {selectedYear} valuation, so their
              values show as &quot;-&quot; and the total value cannot be calculated.
            </p>
          )}

          <section className="mb-6">
            <InventorySummary
              title="Annual Inventory Summary"
              year={Number(selectedYear)}
              metrics={summaryMetrics}
            />
          </section>

          <section className="w-full">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Inventory
            </h2>
            <InventoryTable rows={tableRows} />
          </section>
        </>
      )}
    </main>
  );
}