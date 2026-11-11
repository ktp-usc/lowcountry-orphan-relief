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
import { JotformLinksMenu } from "@/components/jotform-links-menu";

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
    <main className="mx-auto min-h-screen max-w-[1380px] px-4 pb-10 pt-7 sm:px-9">
      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="font-heading text-[23px] font-bold tracking-[-0.45px] text-foreground">
          Lowcountry & Midlands Orphan Relief Inventory
        </h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
              <JotformLinksMenu />
              <SignOutButton />
          </div>
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
              className="mb-[14px] rounded-lg border border-border bg-accent px-[13px] py-[10px] text-[10px] leading-relaxed text-foreground"
            >
              Some items are missing a {selectedYear} valuation, so their
              values show as &quot;-&quot; and the total value cannot be calculated.
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