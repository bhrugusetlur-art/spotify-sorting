import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb() {
  if (database) return database;

  const client = postgres(getEnv().DATABASE_URL, { prepare: false });
  return (database = drizzle(client, { schema }));
}
