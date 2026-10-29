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
  initialValue: number;
  itemsAdded: number;
  itemsSubtracted: number;
  currentCount: number;
  currentValue: number;
};

type InventoryTableProps = {
  rows: InventoryRow[];
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const quantity = new Intl.NumberFormat("en-US");

const headings = [
  "Item",
  "Initial count",
  "Initial value",
  "Quantity sub",
  "Quantity added",
  "Current count",
  "Current value",
];

export default function InventoryTable({ rows }: InventoryTableProps) {
  return (
    <section className="overflow-hidden rounded border border-border bg-card">
      <Table className="min-w-[1050px] border-collapse font-sans text-sm text-foreground">
        <TableHeader className="bg-muted-foreground/10">
          <TableRow className="border-b border-muted-foreground/40 hover:bg-transparent">
            {headings.map((heading, index) => (
              <TableHead
                key={heading}
                scope="col"
                className={`px-3 py-2.5 text-sm font-semibold tracking-normal text-foreground ${
                  index === 0 ? "min-w-[280px] text-left" : "text-right"
                } ${index === 5 ? "border-l border-muted-foreground/20" : ""}`}
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
                <p className="font-semibold">No inventory data available.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Inventory items will appear here when data is provided.
                </p>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.item}
                className="even:bg-muted-foreground/5 hover:bg-transparent"
              >
                <TableCell className="whitespace-normal px-3 py-2.5 font-normal">
                  {row.item}
                </TableCell>

                <TableCell className="px-3 py-2.5 text-right font-normal tabular-nums">
                  {quantity.format(row.initialCount)}
                </TableCell>

                <TableCell className="px-3 py-2.5 text-right font-normal tabular-nums">
                  {currency.format(row.initialValue)}
                </TableCell>

                <TableCell className="px-3 py-2.5 text-right font-normal tabular-nums">
                  {row.itemsSubtracted > 0 ? "−" : ""}
                  {quantity.format(row.itemsSubtracted)}
                </TableCell>

                <TableCell className="px-3 py-2.5 text-right font-normal tabular-nums">
                  {row.itemsAdded > 0 ? "+" : ""}
                  {quantity.format(row.itemsAdded)}
                </TableCell>

                <TableCell className="border-l border-muted-foreground/20 px-3 py-2.5 text-right font-medium tabular-nums">
                  {quantity.format(row.currentCount)}
                </TableCell>

                <TableCell className="px-3 py-2.5 text-right font-medium tabular-nums">
                  {currency.format(row.currentValue)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
