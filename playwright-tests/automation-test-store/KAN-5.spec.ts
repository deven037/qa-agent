import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';


test.describe('Login and Navigation', () => {
  test('TC-001: Successful Login and Navigation to Home Page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Login' }).click();
    await page.getByLabel('Email').fill(APP_EMAIL);
    await page.getByLabel('Password').fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('navigation', { name: 'Left panel' })).toBeVisible();
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('main')).toContainText('Automation Test Store');
    await expect(page.url()).toBe(`${BASE_URL}/home`);
  });
});