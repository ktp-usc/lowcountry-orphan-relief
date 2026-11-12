"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Item = { id: number; code: string; name: string; count: number; valuation: number | null; unit: string; bundled: boolean };
type EditKind = "counts" | "valuations";
type Scope = { year: string; location: string };
type Props = { year: string; location: string; onSaved: (kind: EditKind, scope: Scope) => void };

export function InventoryEditor({ year, location, onSaved }: Props) {
  const [kind, setKind] = useState<EditKind | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<string[]>([]);
  const [expectedValues, setExpectedValues] = useState<Array<number | null>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function open(next: EditKind) {
    const id = ++sessionId.current;
    const currentScope = { year, location };
    setKind(next);
    setScope(currentScope);
    setError("");
    setItems([]);
    setValues([]);
    setBaseline([]);
    setExpectedValues([]);
    setLoading(true);
    setBusy(false);
    try {
      const response = await fetch(`/api/inventory/edit?year=${currentScope.year}&location=${encodeURIComponent(currentScope.location)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load inventory.");
      if (sessionId.current !== id) return;
      const loadedItems = data.items as Item[];
      const initialValues = loadedItems.map((item) => next === "counts" ? String(item.count) : item.valuation === null ? "" : (item.bundled ? item.valuation / 5 : item.valuation).toFixed(2));
      setItems(loadedItems);
      setValues(initialValues);
      setBaseline(initialValues);
      setExpectedValues(loadedItems.map((item) => next === "counts" ? item.count : item.valuation));
    } catch (cause) {
      if (sessionId.current === id) setError(cause instanceof Error ? cause.message : "Could not load inventory.");
    } finally {
      if (sessionId.current === id) setLoading(false);
    }
  }

  function close() {
    ++sessionId.current;
    setKind(null);
    setScope(null);
    setItems([]);
    setValues([]);
    setBaseline([]);
    setExpectedValues([]);
    setLoading(false);
    setBusy(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function save() {
    if (!kind || !scope) return;
    if (values.some((value, index) => value !== baseline[index] && (kind === "counts" ? !/^\d+$/.test(value) : !/^\d+(?:\.\d{1,2})?$/.test(value)))) {
      setError(kind === "counts" ? "Enter a non-negative whole number for every changed count." : "Enter a non-negative amount with at most two decimal places for every changed valuation.");
      return;
    }
    const changedItems = items.flatMap((item, index) => values[index] !== baseline[index] ? [{ id: item.id, value: values[index], expectedValue: expectedValues[index] }] : []);
    if (!changedItems.length) { setError("Make a change before saving."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, year: Number(scope.year), location: scope.location, items: changedItems }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save changes.");
      const savedKind = kind;
      const savedScope = scope;
      close();
      onSaved(savedKind, savedScope);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  const ready = !loading && !busy && items.length > 0;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="outline" className="shrink-0">Edit Inventory<ChevronDown aria-hidden="true" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void open("counts")}>Edit starting counts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void open("valuations")}>Edit unit valuations</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={kind !== null} onOpenChange={(openState) => { if (!openState && kind) close(); }}>
      {kind && scope && <DialogContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <header className="border-b px-6 py-4">
          <DialogTitle>Edit {kind === "counts" ? "starting counts" : "unit valuations"}</DialogTitle>
          <DialogDescription>{scope.year} · {kind === "counts" ? (scope.location === "LOWCOUNTRY" ? "Lowcountry" : "Midlands") : "Both locations"}</DialogDescription>
        </header>
        <div className="overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {loading ? <p className="py-6 text-sm text-muted-foreground">Loading inventory…</p> : items.map((item, index) => <div key={item.id} className="grid grid-cols-1 items-center gap-2 border-b pb-3 sm:grid-cols-[1fr_12rem]">
              <label htmlFor={`item-${item.id}`} className="text-sm font-medium">
                {item.name}{kind === "valuations" && <span className="ml-2 font-normal text-muted-foreground">({item.bundled ? "Each (per pair)" : item.unit})</span>}
              </label>
              <div>
                <input id={`item-${item.id}`} disabled={busy} inputMode={kind === "counts" ? "numeric" : "decimal"} value={values[index] ?? ""} onChange={(event) => setValues((current) => current.map((value, slot) => slot === index ? event.target.value : value))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                {kind === "valuations" && item.bundled && <p className="mt-1 text-right text-xs text-muted-foreground">Bundle price: {values[index] === "" ? "—" : `$${(Number(values[index]) * 5).toFixed(2)}`} · Per bundle (5 pairs)</p>}
              </div>
            </div>)}
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!ready}>{busy ? "Saving…" : "Save"}</Button>
        </footer>
      </DialogContent>}
    </Dialog>
  </>;
}
