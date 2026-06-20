import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';

test.describe('Automation Test Store', () => {
  test('TC-001: Verify user registration and login with registered user is successful', async ({ page }) => {
    await page.goto(`${BASE_URL}/account/register`);
    await expect(page.getByText('Create Account – Sauce Demo')).toBeVisible();

    const createAccountForm = page;
    await createAccountForm.getByLabel('First Name').fill('Automation');
    await expect(createAccountForm.getByLabel('First Name')).toHaveValue('Automation');

    await createAccountForm.getByLabel('Last Name').fill('Test');
    await expect(createAccountForm.getByLabel('Last Name')).toHaveValue('Test');

    await createAccountForm.getByLabel('Email Address').fill(APP_EMAIL);
    await expect(createAccountForm.getByLabel('Email Address')).toHaveValue(APP_EMAIL);

    await createAccountForm.getByLabel('Password').fill(APP_PASSWORD);
    await expect(createAccountForm.getByLabel('Password')).toHaveValue(APP_PASSWORD);

    await createAccountForm.getByRole('button', { name: 'Create' }).click();
    await expect(createAccountForm.getByRole('button', { name: 'Create' })).not.toBeVisible();

    await page.goto(`${BASE_URL}/account/login`);
    await expect(page.getByText('Account – Sauce Demo')).toBeVisible();

    const loginForm = page;
    await loginForm.getByLabel('Email Address').fill(APP_EMAIL);
    await expect(loginForm.getByLabel('Email Address')).toHaveValue(APP_EMAIL);

    await loginForm.getByLabel('Password').fill(APP_PASSWORD);
    await expect(loginForm.getByLabel('Password')).toHaveValue(APP_PASSWORD);

    await loginForm.getByRole('button', { name: 'Sign In' }).click();
    await expect(loginForm.getByRole('button', { name: 'Sign In' })).not.toBeVisible();

    await page.waitForURL(`${BASE_URL}/account`);
    await expect(page.getByText('Account – Sauce Demo')).toBeVisible();
  });
});