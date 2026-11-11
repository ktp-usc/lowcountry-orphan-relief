"use client";

import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const startGoogleSignIn = () =>
  authClient.signIn.social({
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/sign-in?error=not_allowed",
  });

export function SignInRedirect({ error }: { error?: string }) {
  const started = useRef(false);

  // With no error, go straight to Google sign in
  useEffect(() => {
    if (!error && !started.current) {
      started.current = true;
      void startGoogleSignIn();
    }
  }, [error]);

  if (!error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Redirecting to Google sign in...
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        Access denied
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That Google account is not allowed to use this app, or sign in failed.
        Try again with a different account.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await authClient.signOut();
          await startGoogleSignIn();
        }}
      >
        Sign in with Google
      </Button>
    </main>
  );
}