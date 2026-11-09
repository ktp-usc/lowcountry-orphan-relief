"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DashboardFilters, type DashboardLocation } from "@/components/DashboardFilters";
import { DashboardApiError, fetchDashboard } from "@/client/api/inventory";
import { qk } from "@/client/queries/keys";
import InventorySummary from "@/components/inventory-summary";
import InventoryTable from "@/components/inventory-table";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const locationLabels: Record<DashboardLocation, string> = {
  ALL: "All Locations",
  LOWCOUNTRY: "Low Country",
  MIDLANDS: "Midlands",
};

export default function Home() {
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedLocation, setSelectedLocation] =
    useState<DashboardLocation>("ALL");

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.dashboard(selectedYear, selectedLocation),
    queryFn: () => fetchDashboard(selectedYear, selectedLocation),
    gcTime: 0,
    retry: (failureCount, err) =>
      !(err instanceof DashboardApiError && err.status === 422) &&
      failureCount < 3,
  });

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  const hasMissingValuations = rows.some(
    (row) => row.initialValue === null || row.currentValue === null,
  );

  const summaryMetrics = summary
    ? [
        { id: "initial-count", label: "Initial count", value: summary.totalInitialCount },
        { id: "incoming", label: "Items added", value: summary.totalItemsAdded },
        {
          id: "outgoing",
          label: "Items distributed",
          value: summary.totalItemsSubtracted,
        },
        {
          id: "current-count",
          label: "Current count",
          value: summary.totalCurrentCount,
          emphasized: true,
        },
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

  const tableRows = rows.map((row) => ({
    item: row.itemName,
    initialCount: row.initialCount,
    initialValue: row.initialValue,
    itemsSubtracted: row.quantitySub,
    itemsAdded: row.quantityAdd,
    currentCount: row.currentCount,
    currentValue: row.currentValue,
  }));

  const headerTitle = useMemo(
    () => `${locationLabels[selectedLocation]} Inventory ${selectedYear}`,
    [selectedLocation, selectedYear],
  );

  return (
    <main className="min-h-screen bg-background px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">{headerTitle}</h1>
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
              Some items are missing a {selectedYear} valuation, so their values show as
              &quot;-&quot; and the total value cannot be calculated.
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
            <h2 className="mb-4 text-lg font-semibold text-foreground">Inventory</h2>
            <InventoryTable rows={tableRows} />
          </section>
        </>
      )}
    </main>
  );
}
