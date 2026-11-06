import { cn } from "@/lib/utils";

export type InventorySummaryMetric = {
  /** Stable, unique identifier for this metric. */
  id: string;
  label: string;
  /** Numbers use en-US formatting; strings support currency and signed values. */
  value: number | string;
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
  {
    id: "initial-count",
    label: "Initial count",
    value: 12040,
  },
  {
    id: "incoming",
    label: "Items added",
    value: 1250,
  },
  {
    id: "outgoing",
    label: "Items distributed",
    value: 840,
  },
  {
    id: "current-count",
    label: "Current count",
    value: 12450,
    emphasized: true,
  },
  {
    id: "current-value",
    label: "Current value",
    value: "$62,250",
    emphasized: true,
  },
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
        "min-w-0 rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
        <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <span className="text-2xl font-medium tabular-nums">{year}</span>
      </div>

      {displayMetrics.length > 0 ? (
        <dl className="flex flex-col border-t border-border lg:flex-row">
          {displayMetrics.map(({ id, label, value, emphasized = false }) => (
            <div
              key={id}
              className="min-w-0 flex-1 border-border px-5 py-5 not-first:border-t sm:px-6 lg:not-first:border-t-0 lg:not-first:border-l"
            >
              <dt className={cn("text-sm font-medium", emphasized && "font-bold")}>
                {label}
              </dt>
              <dd
                className={cn(
                  "mt-2 break-words text-3xl font-medium tracking-tight tabular-nums",
                  emphasized && "font-bold",
                )}
              >
                {typeof value === "number" ? value.toLocaleString("en-US") : value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="border-t border-border px-5 py-6 text-sm text-muted-foreground sm:px-6">
          No inventory summary available.
        </p>
      )}
    </section>
  );
}
