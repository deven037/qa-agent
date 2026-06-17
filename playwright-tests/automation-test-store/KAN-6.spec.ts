import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';


test.describe('Authentication', () => {
  test('TC-001: Successful Login with Valid Credentials and Navigation to Catalog', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Login' }).click();
    await page.getByLabel('Email').fill(APP_EMAIL);
    await page.getByLabel('Password').fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(new RegExp('/catalog'));
    await expect(page.getByText('Catalog')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Product');
  });
});