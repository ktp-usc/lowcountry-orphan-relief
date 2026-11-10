"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="inline-flex h-9 items-center justify-center rounded-[7px] bg-primary px-[13px] text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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