import { isEmailAllowed } from "@/lib/allowlist";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

import type { Location } from "@/generated/prisma/enums";
import { getDashboard } from "@/lib/inventory/get-dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEmailAllowed(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
    const message =
      error instanceof Error ? error.message : "Unable to load inventory.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}