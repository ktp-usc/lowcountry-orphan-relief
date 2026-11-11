import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function SignedOutPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        You’re signed out
      </h1>
      <Button asChild variant="outline">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    </main>
  );
}