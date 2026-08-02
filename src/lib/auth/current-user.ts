import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { createDrizzleAccountRepository, type LinkedAccountRepository } from "./repository";
import { readSessionToken, SESSION_COOKIE } from "./session";

export async function resolveCurrentAccount(
  token: string | undefined,
  secret: string,
  repository: LinkedAccountRepository,
  now = Date.now(),
) {
  if (!token) return null;
  const session = readSessionToken(token, secret, now);
  return session ? repository.findByUserId(session.userId) : null;
}

export async function getCurrentAccount() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveCurrentAccount(token, getEnv().SESSION_SECRET, createDrizzleAccountRepository());
}
