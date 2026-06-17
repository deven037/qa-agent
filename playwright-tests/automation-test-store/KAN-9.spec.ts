import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';

test.describe("Automation Test Store", function () {
  test("TC-001: Successful Login and Navigation to Wish List with Valid Credentials", async function ({
    page,
  }) {
    await page.goto(BASE_URL);
    await expect(page.getByText("Log In")).toBeVisible();
    await page.getByText("Log In").click();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    const emailInput = page.getByPlaceholder("Email");
    const passwordInput = page.getByPlaceholder("Password");
    await emailInput.fill(APP_EMAIL);
    await passwordInput.fill(APP_PASSWORD);
    await expect(page.getByText("Log In")).toBeVisible();
    await page.getByText("Log In").click();
    await page.waitForURL(BASE_URL + "/account");
    await expect(page.getByText("Wish list")).toBeVisible();
    await page.getByText("Wish list").click();
    await expect(page.getByText("Wish list")).toBeVisible();
    await expect(page.getByText("Your wish list is empty")).toBeVisible();
  });
});
