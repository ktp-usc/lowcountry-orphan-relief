"use client";

import { useState } from "react";
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

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.dashboard(selectedYear, selectedLocation),
    queryFn: () => fetchDashboard(selectedYear, selectedLocation),
    gcTime: 0, // don't keep old results, so every change shows loading
    // Don't retry 422 errors; retrying can't fix them.
    retry: (failureCount, err) =>
      !(err instanceof DashboardApiError && err.status === 422) &&
      failureCount < 3,
  });

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
    itemsSubtracted: row.quantitySub,
    itemsAdded: row.quantityAdd,
    currentCount: row.currentCount,
    currentValue: row.currentValue,
  }));

  return (
    <main className="mx-auto min-h-screen max-w-[1380px] px-4 pb-10 pt-7 sm:px-9">
      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="font-heading text-[23px] font-bold tracking-[-0.45px] text-foreground">
          Lowcountry & Midlands Orphan Relief Inventory
        </h1>
        <SignOutButton />
      </header>

      <section className="mb-[14px]">
        <DashboardFilters
          selectedYear={selectedYear}
          selectedLocation={selectedLocation}
          onYearChange={setSelectedYear}
          onLocationChange={setSelectedLocation}
        />
      </section>

      {isPending ? (
        <p className="text-[11px] text-muted-foreground">Loading inventory...</p>
      ) : isError ? (
        <p role="alert" className="text-[11px] text-destructive">
          Could not load inventory: {error.message}
        </p>
      ) : (
        <>
          {hasMissingValuations && (
            <p
              role="status"
              className="mb-[14px] rounded-lg border border-border bg-accent px-[13px] py-[10px] text-[10px] leading-relaxed text-foreground"
            >
              Some items are missing a {selectedYear} valuation, so their
              values show as "-" and the total value cannot be calculated.
            </p>
          )}

          <section className="mb-[14px]">
            <InventorySummary
              title="Annual Inventory Summary"
              year={Number(selectedYear)}
              metrics={summaryMetrics}
            />
          </section>

          <section className="w-full">
            <h2 className="sr-only">Inventory</h2>
            <InventoryTable rows={tableRows} />
          </section>
        </>
      )}
    </main>
  );
}