// 브라우저에서 S1~S3 핵심 시나리오를 처음부터 끝까지 클릭해 보는 E2E 테스트(목업 모드)
import { expect, test } from "@playwright/test";

test("S1: an example person gets a four-week Korean plan with reasons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sample data — not live Qloo")).toBeVisible();
  await page.getByRole("button", { name: /Mina, 15/ }).click();
  await expect(page.getByRole("heading", { name: /Four weeks of Korean for someone who loves Minecraft, Olivia Rodrigo and Stranger Things/ })).toBeVisible();
  await expect(page.getByText(/^Week [1-4]$/)).toHaveCount(4);
  await expect(page.getByText("Because you like").first()).toBeVisible();
  await expect(page.getByText(/With family:/).first()).toBeVisible();
  await expect(page.getByText("Your taste, as Qloo sees it:")).toBeVisible();
  await expect(page).toHaveURL(/l=ko/);
  await page.getByText(/How this plan was made/).click();
  await expect(page.getByText(/Qloo #1/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/s1-plan.png", fullPage: true });
});

test("S2: an ambiguous favorite is confirmed, then the plan is compared with a generic list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Sam, 34/ }).click();
  await expect(page.getByRole("heading", { name: "Which one do you mean?" })).toBeVisible();
  await page.getByRole("button", { name: /2005, United States/ }).click();
  await expect(page.getByRole("heading", { name: /Four weeks of Spanish/ })).toBeVisible();
  await page.getByRole("button", { name: "Compare with a generic AI list" }).click();
  await expect(page.getByText("This plan (Qloo-grounded)")).toBeVisible();
  await expect(page.getByText("From a country that speaks the language")).toBeVisible();
  await expect(page.getByText("Favorites it draws on (Qloo explainability)")).toBeVisible();
  await expect(page.getByText(/so this row tends to favour it/)).toBeVisible();
  await page.screenshot({ path: "test-results/s2-compare.png", fullPage: true });
});

test("S3: a shared link reopens the plan and a refinement removes violent genres", async ({ page }) => {
  await page.goto("/?l=ko&v=beginner&f=Minecraft&f=Olivia+Rodrigo&f=Stranger+Things&a=15&fam=1");
  await expect(page.getByRole("heading", { name: /Four weeks of Korean/ })).toBeVisible();
  await page.getByLabel("What should change?").fill("No violence please. She already watched Signal.");
  await page.getByRole("button", { name: "Update plan" }).click();
  await expect(page.getByText(/Avoiding: Thriller, Crime, Horror, War, Action/)).toBeVisible();
  await expect(page.getByText("Removed: Signal")).toBeVisible();
  await expect(page).toHaveURL(/r=No\+violence/);
});

test("mobile layout has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
