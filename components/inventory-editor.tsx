"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Item = { id: number; code: string; name: string; count: number; valuation: number; unit: string; bundled: boolean };
type Props = { year: string; location: string; onSaved: () => void };

export function InventoryEditor({ year, location, onSaved }: Props) {
  const [kind, setKind] = useState<"counts" | "valuations" | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  async function open(next: "counts" | "valuations") {
    setError(""); setLoading(true);
    setItems([]); setValues([]);
    setKind(next);
    try {
      const response = await fetch(`/api/inventory/edit?year=${year}&location=${encodeURIComponent(location)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load inventory.");
      setItems(data.items);
      setValues(data.items.map((item: Item) => next === "counts" ? String(item.count) : (item.bundled ? item.valuation / 5 : item.valuation).toFixed(2)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load inventory."); }
    finally { setLoading(false); }
  }

  async function save() {
    if (values.some((value) => kind === "counts" ? !/^\d+$/.test(value) : !/^\d+(?:\.\d{1,2})?$/.test(value))) {
      setError(kind === "counts" ? "Enter a non-negative whole number for every count." : "Enter a non-negative amount with at most two decimal places for every valuation."); return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, year: Number(year), location, items: items.map((item, index) => ({ id: item.id, value: values[index] })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save changes.");
      setKind(null); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save changes."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="relative flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="shrink-0">Edit Inventory<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void open("counts")}>Edit starting counts</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void open("valuations")}>Edit unit valuations</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !kind && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </div>
    {kind && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setKind(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="inventory-editor-title" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border bg-card text-card-foreground shadow-xl">
        <header className="border-b px-6 py-4"><h2 id="inventory-editor-title" className="text-lg font-semibold">Edit {kind === "counts" ? "starting counts" : "unit valuations"}</h2><p className="mt-1 text-sm text-muted-foreground">{year} · {kind === "counts" ? (location === "LOWCOUNTRY" ? "Lowcountry" : "Midlands") : "Both locations"}</p></header>
        <div className="overflow-y-auto px-6 py-4"><div className="space-y-3">
          {loading ? <p className="py-6 text-sm text-muted-foreground">Loading inventory…</p> : items.map((item, index) => <div key={item.id} className="grid grid-cols-1 items-center gap-2 border-b pb-3 sm:grid-cols-[1fr_12rem]">
            <label htmlFor={`item-${item.id}`} className="text-sm font-medium">{item.name}{kind === "valuations" && <span className="ml-2 font-normal text-muted-foreground">({item.bundled ? "Each (per pair)" : item.unit})</span>}</label>
            <div><input id={`item-${item.id}`} inputMode={kind === "counts" ? "numeric" : "decimal"} value={values[index] ?? ""} onChange={(event) => setValues((current) => current.map((value, slot) => slot === index ? event.target.value : value))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              {kind === "valuations" && item.bundled && <p className="mt-1 text-right text-xs text-muted-foreground">Bundle price: ${(Number(values[index] || 0) * 5).toFixed(2)} · Per bundle (5 pairs)</p>}</div>
          </div>)}
        </div>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4"><Button variant="outline" onClick={() => setKind(null)} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></footer>
      </section>
    </div>}
  </>;
}
