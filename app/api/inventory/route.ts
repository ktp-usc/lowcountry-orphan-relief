import { NextResponse } from "next/server";

import { getDashboard } from "@/lib/inventory/get-dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const year = Number(params.get("year"));
  const location = params.get("location");

  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    return NextResponse.json(
      { error: "Provide a year between 1900 and 9999." },
      { status: 400 },
    );
  }

  if (
    location !== "ALL" &&
    location !== "LOWCOUNTRY" &&
    location !== "MIDLANDS"
  ) {
    return NextResponse.json(
      { error: "Provide location ALL, LOWCOUNTRY, or MIDLANDS." },
      { status: 400 },
    );
  }

  try {
    const data = await getDashboard(year, location);
    return NextResponse.json({ data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load inventory.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}