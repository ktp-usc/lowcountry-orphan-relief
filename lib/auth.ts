import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { isEmailAllowed } from "@/lib/allowlist";
import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Always show Google's account chooser (handy for testing a second account)
      prompt: "select_account",
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Stop anyone who isn't on the allowlist from creating an account
        before: async (user) => {
          if (!isEmailAllowed(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "This account is not on the allowlist.",
            });
          }
        },
      },
    },
  },
  plugins: [nextCookies()],
});