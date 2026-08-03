import { expect, test } from "@playwright/test";

test("landing page explains the workflow and exposes Spotify login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /sort your liked songs by mood/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /connect spotify/i })).toHaveAttribute("href", "/api/auth/spotify/start");
});

test("health endpoint returns a stable payload", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});

// Exercises getCurrentAccount() -> getEnv() against a real server process, so a
// missing or invalid environment surfaces here rather than in production.
test("unauthenticated dashboard visits redirect to the landing page", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL must be configured");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new URL("/", baseURL).toString());
  await expect(page.getByRole("heading", { name: /sort your liked songs by mood/i })).toBeVisible();
});
