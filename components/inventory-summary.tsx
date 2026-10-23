import { cn } from "@/lib/utils";

export type InventorySummaryMetric = {
  /** Stable, unique identifier for this metric. */
  id: string;
  label: string;
  /** Numbers use en-US formatting; strings support currency and signed values. */
  value: number | string;
  description?: string;
  tone?: "neutral" | "positive" | "negative" | "pending";
};

export type InventorySummaryProps = {
  title?: string;
  description?: string;
  /** Omit to display labeled sample data. An empty array shows an empty state. */
  metrics?: readonly InventorySummaryMetric[];
  className?: string;
};

const placeholderMetrics: readonly InventorySummaryMetric[] = [
  {
    id: "current-stock",
    label: "Current inventory",
    value: 12450,
    description: "Items on hand",
  },
  {
    id: "incoming",
    label: "Items added",
    value: "+1,250",
    description: "Received this month",
    tone: "positive",
  },
  {
    id: "outgoing",
    label: "Items distributed",
    value: "−840",
    description: "Sent out this month",
    tone: "negative",
  },
  {
    id: "pending",
    label: "Pending requests",
    value: 125,
    description: "Items awaiting fulfillment",
    tone: "pending",
  },
  {
    id: "estimated-value",
    label: "Estimated inventory value",
    value: "$62,250",
    description: "Estimated value of items on hand",
  },
];

const toneClasses = {
  neutral: "text-foreground",
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-red-700 dark:text-red-400",
  pending: "text-amber-700 dark:text-amber-400",
};

/**
 * A continuous inventory overview, ready for server or client component use.
 * Render <InventorySummary /> for placeholders, or supply metrics from the
 * dashboard's selected location and reporting period. Values are display-only;
 * inventory calculations and valuation belong in the data layer.
 */
export default function InventorySummary({
  title = "Inventory summary",
  description = "Inventory activity and estimated value",
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
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {metrics === undefined && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Sample data
          </span>
        )}
      </div>

      {displayMetrics.length > 0 ? (
        <dl className="flex flex-col border-t border-border lg:flex-row">
          {displayMetrics.map(({ id, label, value, description, tone = "neutral" }) => (
            <div
              key={id}
              className="min-w-0 flex-1 border-border px-5 py-5 not-first:border-t sm:px-6 lg:not-first:border-t-0 lg:not-first:border-l"
            >
              <dt className="text-sm font-medium text-muted-foreground">
                {label}
              </dt>
              <dd
                className={cn(
                  "mt-2 break-words text-3xl font-semibold tracking-tight tabular-nums",
                  toneClasses[tone],
                )}
              >
                {typeof value === "number" ? value.toLocaleString("en-US") : value}
              </dd>
              {description && (
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  {description}
                </dd>
              )}
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
