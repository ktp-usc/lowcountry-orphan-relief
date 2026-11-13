import type { SheetRefreshStatus } from "@/lib/sheets/refresh-status";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

export function InventoryRefreshStatus({ refresh }: { refresh?: SheetRefreshStatus }) {
  if (!refresh || refresh.unavailable || (!refresh.inventory && !refresh.referrals)) {
    return null;
  }
  const timestamp = (value: string) => <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;

  return (
    <div role="status" className="mb-[14px] flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Last successful refresh:</span>
      {refresh.inventory && <span>Inventory: {timestamp(refresh.inventory)}</span>}
      {refresh.referrals && <span>Referrals: {timestamp(refresh.referrals)}</span>}
    </div>
  );
}
