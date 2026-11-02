import type { Metadata } from "next";

import InventorySummary from "@/components/inventory-summary";

export const metadata: Metadata = {
  title: "Inventory summary preview",
};

export default function PreviewSummaryPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Inventory summary preview
        </h1>
        <InventorySummary />
      </div>
    </main>
  );
}
