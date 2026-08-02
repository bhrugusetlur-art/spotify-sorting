import { healthStatus } from "@/lib/health";

export function GET(): Response {
  return Response.json(healthStatus());
}
