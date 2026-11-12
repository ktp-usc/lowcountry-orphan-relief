import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type InventoryRow = {
  item: string;
  initialCount: number;
  valuePerUnit?: number | null;
  initialValue: number | null;
  itemsAdded: number;
  itemsSubtracted: number;
  currentCount: number;
  currentValue: number | null;
};

type InventoryTableProps = {
  rows: InventoryRow[];
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const quantity = new Intl.NumberFormat("en-US");
const formatValue = (value: number | null) =>
  value === null ? "-" : currency.format(value);

const headings = [
  "Item",
  "Unit valuation",
  "Initial count",
  "Initial value",
  "Quantity sub",
  "Quantity added",
  "Current count",
  "Current value",
];

const numberCell =
  "h-10 px-3 py-0 text-right text-sm font-normal tabular-nums text-foreground";

export default function InventoryTable({ rows }: InventoryTableProps) {
  return (
    <section className="overflow-hidden rounded-[9px] border border-border bg-card">
      <Table className="min-w-[900px] border-collapse font-sans text-sm text-foreground">
        <TableHeader className="bg-table-header">
          <TableRow className="border-b border-line-soft hover:bg-transparent">
            {headings.map((heading, index) => (
              <TableHead
                key={heading}
                scope="col"
                className={`h-9 px-3 text-xs font-bold uppercase tracking-[0.35px] text-muted-foreground ${
                  index === 0 ? "min-w-[250px] text-left" : "text-right"
                }`}
              >
                {heading}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={headings.length}
                className="h-40 px-3 py-2.5 text-center"
              >
                <p className="text-[11px] font-semibold text-foreground">
                  No inventory data available.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Inventory items will appear here when data is provided.
                </p>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.item}
                className="border-b border-line-soft even:bg-stripe hover:bg-transparent"
              >
                <TableCell className="h-10 min-w-[250px] whitespace-normal px-3 py-0 text-sm font-medium text-foreground">
                  {row.item}
                </TableCell>

                <TableCell className={numberCell}>
                  {formatValue(row.valuePerUnit ?? null)}
                </TableCell>

                <TableCell className={numberCell}>
                  {quantity.format(row.initialCount)}
                </TableCell>

                <TableCell className={numberCell}>
                  {formatValue(row.initialValue)}
                </TableCell>

                <TableCell className={numberCell}>
                  {row.itemsSubtracted > 0 ? "−" : ""}
                  {quantity.format(row.itemsSubtracted)}
                </TableCell>

                <TableCell className={numberCell}>
                  {row.itemsAdded > 0 ? "+" : ""}
                  {quantity.format(row.itemsAdded)}
                </TableCell>

                <TableCell className={numberCell}>
                  {quantity.format(row.currentCount)}
                </TableCell>

                <TableCell className={numberCell}>
                  {formatValue(row.currentValue)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
