import {
  Table,
  TableBody,
  TableCaption,
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
  "Initial Count",
  "Initial Value",
  "Quantity Subtracted",
  "Quantity Added",
  "Current Count",
  "Current Value",
];

export default function InventoryTable({ rows }: InventoryTableProps) {
  return (
    <section className="overflow-hidden rounded-lg border bg-background">
      <header className="border-b px-4 py-5 sm:px-6">
        <h2 className="text-xl font-bold">
          Low Country Orphan Relief inventory
        </h2>
      </header>

      <Table className="min-w-[1050px]">
        <TableCaption className="pb-4">
          Inventory quantities and estimated values in USD.
        </TableCaption>

        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            {headings.map((heading, index) => (
              <TableHead
                key={heading}
                scope="col"
                className={`px-4 py-4 font-bold text-foreground ${
                  index === 0 ? "min-w-[280px] text-left" : "text-right"
                } ${index === 5 ? "border-l" : ""}`}
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
                className="h-40 text-center"
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
                className="even:bg-muted/30 hover:bg-muted/60"
              >
                <TableCell className="whitespace-normal px-4 py-3 font-bold">
                  {row.item}
                </TableCell>

                <TableCell className="px-4 text-right tabular-nums">
                  {quantity.format(row.initialCount)}
                </TableCell>

                <TableCell className="px-4 text-right tabular-nums">
                  {currency.format(row.initialValue)}
                </TableCell>

                <TableCell className="px-4 text-right tabular-nums">
                  <span
                    className={
                      row.itemsSubtracted > 0
                        ? "font-medium text-red-700 dark:text-red-400"
                        : "text-muted-foreground"
                    }
                  >
                    {row.itemsSubtracted > 0 ? "−" : ""}
                    {quantity.format(row.itemsSubtracted)}
                  </span>
                </TableCell>

                <TableCell className="px-4 text-right tabular-nums">
                  <span
                    className={
                      row.itemsAdded > 0
                        ? "font-medium text-green-700 dark:text-green-400"
                        : "text-muted-foreground"
                    }
                  >
                    {row.itemsAdded > 0 ? "+" : ""}
                    {quantity.format(row.itemsAdded)}
                  </span>
                </TableCell>

                <TableCell className="border-l bg-muted/20 px-4 text-right font-bold tabular-nums">
                  {quantity.format(row.currentCount)}
                </TableCell>

                <TableCell className="bg-muted/20 px-4 text-right font-bold tabular-nums">
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