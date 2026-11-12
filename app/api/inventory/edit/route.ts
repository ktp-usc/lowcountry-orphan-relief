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
    valuation: item.valuations[0]?.valuePerUnit.toNumber() ?? 0,
    unit: itemValuations.find((entry) => entry.code === item.code)?.unit ?? "Each",
    bundled: bundleCodes.has(item.code),
  })) });
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { kind, year, location, items } = body as { kind?: string; year?: number; location?: string; items?: { id: number; value: string | number }[] };
  if (!validYear(Number(year)) || !Array.isArray(items)) return NextResponse.json({ error: "Invalid year or item values." }, { status: 400 });
  if (kind === "counts" && (!location || !locations.has(location as Location))) return NextResponse.json({ error: "Choose a location." }, { status: 400 });
  if (kind !== "counts" && kind !== "valuations") return NextResponse.json({ error: "Invalid edit type." }, { status: 400 });
  if (items.some((entry) => !entry || !Number.isSafeInteger(entry.id) || (typeof entry.value !== "string" && typeof entry.value !== "number"))) return NextResponse.json({ error: "Invalid item values." }, { status: 400 });

  const catalogue = await prisma.item.findMany({ select: { id: true, code: true } });
  if (items.length !== catalogue.length || new Set(items.map((item) => item.id)).size !== catalogue.length || catalogue.some((item) => !items.some((entry) => entry.id === item.id))) {
    return NextResponse.json({ error: "Include one value for every item category." }, { status: 400 });
  }
  for (const entry of items) {
    const value = String(entry.value);
    if (kind === "counts" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return NextResponse.json({ error: "Starting counts must be non-negative integers." }, { status: 400 });
    if (kind === "valuations" && (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 9999999999.99)) return NextResponse.json({ error: "Valuations must be non-negative amounts with at most two decimal places." }, { status: 400 });
  }

  await prisma.$transaction(items.map((entry) => {
    if (kind === "counts") return prisma.startingInventory.upsert({
      where: { itemId_year_location: { itemId: entry.id, year: Number(year), location: location as Location } },
      create: { itemId: entry.id, year: Number(year), location: location as Location, startingQuantity: Number(entry.value) },
      update: { startingQuantity: Number(entry.value) },
    });
    const code = catalogue.find((item) => item.id === entry.id)!.code;
    const amount = Number(entry.value) * (bundleCodes.has(code) ? 5 : 1);
    return prisma.itemValuation.upsert({
      where: { itemId_year: { itemId: entry.id, year: Number(year) } },
      create: { itemId: entry.id, year: Number(year), valuePerUnit: amount.toFixed(2) },
      update: { valuePerUnit: amount.toFixed(2) },
    });
  }));
  return NextResponse.json({ success: true });
}
