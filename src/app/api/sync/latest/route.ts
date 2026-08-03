import { createProductionSyncHandlers } from "@/lib/sync/production";

const handlers = createProductionSyncHandlers();

export async function GET(): Promise<Response> {
  return handlers.latest();
}
