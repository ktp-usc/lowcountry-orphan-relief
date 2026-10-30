import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Generation works without credentials; database commands require a URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
