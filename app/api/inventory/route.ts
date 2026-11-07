import { NextResponse } from "next/server";

import type { Location } from "@/generated/prisma/enums";
import { getDashboard } from "@/lib/inventory/get-dashboard";
import { MissingValuationsError } from "@/lib/inventory/get-inventory-query";

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

  if (location !== "LOWCOUNTRY" && location !== "MIDLANDS") {
    return NextResponse.json(
      { error: "Provide location LOWCOUNTRY or MIDLANDS." },
      { status: 400 },
    );
  }

  try {
    const data = await getDashboard(year, location as Location);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof MissingValuationsError) {
      return NextResponse.json(
        { error: error.message, code: "MISSING_VALUATIONS", year: error.year },
        { status: 422 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unable to load inventory.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}