import { NextResponse } from "next/server";
import type { Location } from "@/generated/prisma/enums";
import { isEmailAllowed } from "@/lib/allowlist";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { itemValuations } from "@/prisma/seed-data";

export const runtime = "nodejs";

const bundleCodes = new Set(["MENS_SOCKS", "MENS_UNDERWEAR", "WOMENS_SOCKS", "WOMENS_UNDERWEAR", "CHILDRENS_SOCKS", "CHILDRENS_UNDERWEAR"]);
const locations = new Set<Location>(["LOWCOUNTRY", "MIDLANDS"]);

async function isAuthorized() {
  const session = await getSession();
  return !!session && isEmailAllowed(session.user.email);
}

function validYear(year: number) {
  return Number.isInteger(year) && year >= 1900 && year <= 9999;
}

export async function GET(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const year = Number(params.get("year"));
  const location = params.get("location");
  if (!validYear(year)) return NextResponse.json({ error: "Invalid year." }, { status: 400 });
  if (!location || !locations.has(location as Location)) return NextResponse.json({ error: "Invalid location." }, { status: 400 });

  const items = await prisma.item.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, code: true, displayName: true, startingInventories: { where: { year, location: location as Location }, select: { startingQuantity: true } }, valuations: { where: { year }, select: { valuePerUnit: true } } },
  });
  return NextResponse.json({ items: items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.displayName,
    count: item.startingInventories[0]?.startingQuantity ?? 0,
    valuation: item.valuations[0]?.valuePerUnit.toNumber() ?? null,
    unit: itemValuations.find((entry) => entry.code === item.code)?.unit ?? "Each",
    bundled: bundleCodes.has(item.code),
  })) });
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { kind, year, location, items } = body as { kind?: string; year?: number; location?: string; items?: { id: number; value: string | number; expectedValue: number | null }[] };
  if (!validYear(Number(year)) || !Array.isArray(items)) return NextResponse.json({ error: "Invalid year or item values." }, { status: 400 });
  if (kind === "counts" && (!location || !locations.has(location as Location))) return NextResponse.json({ error: "Choose a location." }, { status: 400 });
  if (kind !== "counts" && kind !== "valuations") return NextResponse.json({ error: "Invalid edit type." }, { status: 400 });
  if (items.some((entry) => !entry || !Number.isSafeInteger(entry.id) || (typeof entry.value !== "string" && typeof entry.value !== "number") || (entry.expectedValue !== null && typeof entry.expectedValue !== "number"))) return NextResponse.json({ error: "Invalid item values." }, { status: 400 });

  const catalogue = await prisma.item.findMany({ select: { id: true, code: true } });
  if (!items.length || new Set(items.map((item) => item.id)).size !== items.length || items.some((entry) => !catalogue.some((item) => item.id === entry.id))) return NextResponse.json({ error: "Include valid item values." }, { status: 400 });
  for (const entry of items) {
    const value = String(entry.value);
    if (kind === "counts" && (!/^\d+$/.test(value) || Number(value) > 2147483647 || !Number.isSafeInteger(Number(entry.expectedValue)))) return NextResponse.json({ error: "Starting counts must be non-negative integers no greater than 2147483647." }, { status: 400 });
    if (kind === "valuations") {
      const cents = /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : Number.NaN;
      const bundled = bundleCodes.has(catalogue.find((item) => item.id === entry.id)!.code);
      if (!Number.isSafeInteger(cents) || !Number.isFinite(Number(value)) || !Number.isFinite(Number(entry.expectedValue)) && entry.expectedValue !== null || cents * (bundled ? 5 : 1) > 999999999999) return NextResponse.json({ error: "Valuations must be non-negative amounts with at most two decimal places and fit the stored value range." }, { status: 400 });
    } else if (typeof entry.expectedValue !== "number" || !Number.isSafeInteger(entry.expectedValue) || entry.expectedValue < 0 || entry.expectedValue > 2147483647) return NextResponse.json({ error: "Invalid expected starting count." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const ids = items.map((entry) => entry.id);
      const current = kind === "counts"
        ? await tx.startingInventory.findMany({ where: { year: Number(year), location: location as Location, itemId: { in: ids } } })
        : await tx.itemValuation.findMany({ where: { year: Number(year), itemId: { in: ids } } });
      for (const entry of items) {
        const row = current.find((record) => record.itemId === entry.id);
        const actual = kind === "counts" ? ((row as { startingQuantity: number } | undefined)?.startingQuantity ?? 0) : ((row as { valuePerUnit: { toNumber(): number } } | undefined)?.valuePerUnit.toNumber() ?? null);
        if (actual !== entry.expectedValue) throw new Error("INVENTORY_EDIT_CONFLICT");
      }
      for (const entry of items) {
        if (kind === "counts") {
          await tx.startingInventory.upsert({
            where: { itemId_year_location: { itemId: entry.id, year: Number(year), location: location as Location } },
            create: { itemId: entry.id, year: Number(year), location: location as Location, startingQuantity: Number(entry.value) },
            update: { startingQuantity: Number(entry.value) },
          });
        } else {
          const code = catalogue.find((item) => item.id === entry.id)!.code;
          const cents = Math.round(Number(entry.value) * 100) * (bundleCodes.has(code) ? 5 : 1);
          const amount = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
          await tx.itemValuation.upsert({
            where: { itemId_year: { itemId: entry.id, year: Number(year) } },
            create: { itemId: entry.id, year: Number(year), valuePerUnit: amount },
            update: { valuePerUnit: amount },
          });
        }
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Error && error.message === "INVENTORY_EDIT_CONFLICT") return NextResponse.json({ error: "Inventory changed since you opened this editor. Reload the editor and try again." }, { status: 409 });
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2034" || error.code === "P2002")) return NextResponse.json({ error: "Inventory changed since you opened this editor. Reload the editor and try again." }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ success: true });
}
