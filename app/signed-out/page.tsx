import Link from "next/link";

export default function SignedOutPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        You’re signed out
      </h1>
      <Link
        href="/sign-in"
        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
      >
        Sign in
      </Link>
    </main>
  );
}