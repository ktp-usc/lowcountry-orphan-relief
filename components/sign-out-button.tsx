"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
  <Button
      type="button"
      onClick={() =>
        authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              // Remove all cached data once sign out has succeeded
              queryClient.clear();
              router.push("/signed-out");
            },
          },
        })
      }
    >
      Sign out
    </Button>
  );
}