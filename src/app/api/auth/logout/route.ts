import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  void request;
  (await cookies()).delete(SESSION_COOKIE);
  const appOrigin = new URL(getEnv().SPOTIFY_REDIRECT_URI).origin;
  return NextResponse.redirect(new URL("/", appOrigin), { status: 303 });
}
