import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';


test.describe('Cart Functionality', () => {
  test('TC-001 Successful Addition of a Single Product to Cart by a Logged-in User', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Login' }).click();
    await page.getByLabel('Email').fill(APP_EMAIL);
    await page.getByLabel('Password').fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
    await page.getByRole('link', { name: 'Product Catalog' }).click();
    const productLink = page.getByRole('link', { name: /Product [0-9]+/ });
    await productLink.click();
    const productDetails = page.getByText(/Product [0-9]+ Details/);
    await expect(productDetails).toBeVisible();
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await page.getByRole('link', { name: 'Cart' }).click();
    const cartProduct = page.getByText(/Product [0-9]+ \(1\)/);
    await expect(cartProduct).toBeVisible();
    const cartQuantity = page.getByText('Quantity: 1');
    await expect(cartQuantity).toBeVisible();
    const cartTotal = page.getByText(/Total: \$/);
    await expect(cartTotal).toBeVisible();
  });
});