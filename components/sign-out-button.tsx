"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
      onClick={() =>
        authClient.signOut({
          fetchOptions: { onSuccess: () => router.push("/signed-out") },
        })
      }
    >
      Sign out
    </button>
  );
}