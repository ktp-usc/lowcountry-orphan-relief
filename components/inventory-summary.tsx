import { cn } from "@/lib/utils";

export type InventorySummaryMetric = {
  /** Stable, unique identifier for this metric. */
  id: string;
  label: string;
  /** Numbers use en-US formatting; strings support currency and signed values. */
  value: number | string | null;
  emphasized?: boolean;
};

export type InventorySummaryProps = {
  title?: string;
  /** Reporting year displayed in the header. Defaults to the current year. */
  year?: number;
  /** Omit to display placeholder metrics. An empty array shows an empty state. */
  metrics?: readonly InventorySummaryMetric[];
  className?: string;
};

const placeholderMetrics: readonly InventorySummaryMetric[] = [
  { id: "initial-count", label: "Initial count", value: 12040 },
  { id: "incoming", label: "Items added", value: 1250 },
  { id: "outgoing", label: "Items distributed", value: 840 },
  { id: "current-count", label: "Current count", value: 12450, emphasized: true },
  { id: "current-value", label: "Current value", value: "$62,250", emphasized: true },
];

/**
 * A continuous inventory overview, ready for server or client component use.
 * Render <InventorySummary /> for placeholders, or supply metrics from the
 * dashboard's selected location and reporting period. Values are display-only;
 * inventory calculations and valuation belong in the data layer.
 */
export default function InventorySummary({
  title = "Inventory summary",
  year = new Date().getFullYear(),
  metrics,
  className,
}: InventorySummaryProps) {
  const displayMetrics = metrics ?? placeholderMetrics;

  return (
    <section
      aria-label={title}
      className={cn(
        "min-w-0 overflow-hidden rounded-[9px] border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-[17px] pb-3 pt-[17px]">
        <h2 className="min-w-0 break-words font-heading text-[13px] font-bold text-foreground">
          {title}
        </h2>
        <span className="font-heading text-[13px] font-bold tabular-nums text-foreground">
          {year}
        </span>
      </div>

      {displayMetrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px border-t border-line-soft bg-line-soft lg:grid-cols-5">
          {displayMetrics.map(({ id, label, value }) => (
            <div
              key={id}
              className="flex min-w-0 flex-col gap-[7px] bg-card px-4 py-[13px] last:col-span-2 lg:last:col-span-1"
            >
              <dt className="text-[9px] text-muted-foreground">{label}</dt>
              <dd className="break-words font-heading text-[17px] font-bold tabular-nums text-foreground">
                {value === null
                  ? "-"
                  : typeof value === "number"
                    ? value.toLocaleString("en-US")
                    : value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="border-t border-line-soft px-[17px] py-6 text-[11px] text-muted-foreground">
          No inventory summary available.
        </p>
      )}
    </section>
  );
}
