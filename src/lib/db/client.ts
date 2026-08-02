import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type SqlClient = ReturnType<typeof postgres>;

let database: Database | undefined;
let sqlClient: SqlClient | undefined;

export function getDb(): Database {
  if (database) return database;

  sqlClient = postgres(getEnv().DATABASE_URL, { prepare: false });
  database = drizzle(sqlClient, { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  const client = sqlClient;
  database = undefined;
  sqlClient = undefined;
  if (client) await client.end({ timeout: 5 });
}
