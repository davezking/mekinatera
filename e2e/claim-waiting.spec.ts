// The waiting state's typo help (docs/design.md, Claim states): most long waits are a mistyped
// transaction number, so the page asks the buyer to check it and keeps it in the form to fix.
import { expect, test } from "@playwright/test";
import { freshTxn, submitClaim, useUniqueClientIp } from "./helpers";

const SEALION = "byd-sealion-2026";

useUniqueClientIp(test);

test("waiting asks to check the number, and Change number keeps it for editing", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`/m/${SEALION}`);
  const txn = freshTxn("TYPO");
  await submitClaim(page, txn);

  await expect(page.getByText("Waiting for telebirr confirmation")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("letter by letter")).toBeVisible();
  const hint = page.getByText("The number may have a typo.");
  await expect(hint).toHaveCount(0);

  // After a minute of waiting, the stronger hint appears.
  await page.clock.fastForward(61_000);
  await expect(hint).toBeVisible();

  await page.getByRole("button", { name: "Change number" }).click();
  await expect(page.locator("#txn")).toBeVisible();
  await expect(page.locator("#txn")).toHaveValue(txn);
  await expect(page.getByText("Waiting for telebirr confirmation")).toHaveCount(0);
});
