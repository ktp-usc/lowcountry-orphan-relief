"use client";

import { useState } from "react";

import { DashboardFilters } from "@/components/DashboardFilters";
import InventorySummary from "@/components/inventory-summary";
import InventoryTable from "@/components/inventory-table";
import { calculateRow } from "@/lib/inventory/calculate-row";
import { sampleInputs } from "@/lib/inventory/sample-data";
import { summarizeInventory } from "@/lib/inventory/summarize";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Sample data -> row calculation (KAN-12) -> summary (KAN-13)
const calculatedRows = sampleInputs.map(calculateRow);
const summary = summarizeInventory(calculatedRows);

const summaryMetrics = [
  { id: "initial-count", label: "Initial count", value: summary.totalInitialCount },
  { id: "incoming", label: "Items added", value: summary.totalItemsAdded },
  { id: "outgoing", label: "Items distributed", value: summary.totalItemsSubtracted },
  { id: "current-count", label: "Current count", value: summary.totalCurrentCount, emphasized: true },
  { id: "current-value", label: "Current value", value: currency.format(summary.totalCurrentValue), emphasized: true },
];

// The table uses slightly different field names than the inventory library
const tableRows = calculatedRows.map((row) => ({
  item: row.itemName,
  initialCount: row.initialCount,
  initialValue: row.initialValue,
  itemsSubtracted: row.quantitySub,
  itemsAdded: row.quantityAdd,
  currentCount: row.currentCount,
  currentValue: row.currentValue,
}));

export default function Home() {
  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear())
  );
  const [selectedLocation, setSelectedLocation] = useState("All Locations");

  return (
    <main className="min-h-screen bg-background px-6 py-8 md:px-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          Lowcountry Orphan Relief Inventory
        </h1>
      </header>

      <section className="mb-6">
        <DashboardFilters
          selectedYear={selectedYear}
          selectedLocation={selectedLocation}
          onYearChange={setSelectedYear}
          onLocationChange={setSelectedLocation}
        />
      </section>

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
    </main>
  );
}

