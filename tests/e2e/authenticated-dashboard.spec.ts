import { expect, test } from "@playwright/test";
import { establishMockCallbackSession } from "./support/mock-callback-session";

test("a mocked successful callback session reaches the authenticated dashboard", async ({ context, page, baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL must be configured");
  const cleanup = await establishMockCallbackSession(context, { displayName: "Ada" });
  try {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new URL("/dashboard", baseURL).toString());
    await expect(page.getByText(/connected as ada/i)).toBeVisible();
    for (const mood of ["Chill", "Hype", "Focus", "Sad", "Happy"]) {
      await expect(page.getByText(mood, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Sort My Music" })).toBeEnabled();
  } finally {
    await cleanup();
  }
});
