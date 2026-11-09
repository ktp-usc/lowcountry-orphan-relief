import { redirect } from "next/navigation";
import React from "react";

import { isEmailAllowed } from "@/lib/allowlist";
import { getSession } from "@/lib/session";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect("/sign-in");
  if (!isEmailAllowed(session.user.email)) {
    redirect("/sign-in?error=not_allowed");
  }

  return <>{children}</>;
}