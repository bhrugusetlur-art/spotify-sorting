import { createProductionSyncHandlers } from "@/lib/sync/production";

const handlers = createProductionSyncHandlers();

export async function POST(): Promise<Response> {
  return handlers.post();
}
