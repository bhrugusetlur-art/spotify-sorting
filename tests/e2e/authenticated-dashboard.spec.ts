import { expect, test } from "@playwright/test";
import { establishMockCallbackSession } from "./support/mock-callback-session";

test("a mocked successful callback session reaches the authenticated dashboard", async ({ context, page }) => {
  const cleanup = await establishMockCallbackSession(context, { displayName: "Ada" });
  try {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("http://127.0.0.1:3000/dashboard");
    await expect(page.getByText(/connected as ada/i)).toBeVisible();
    for (const mood of ["Chill", "Hype", "Focus", "Sad", "Happy"]) {
      await expect(page.getByText(mood, { exact: true })).toBeVisible();
    }
  } finally {
    await cleanup();
  }
});
