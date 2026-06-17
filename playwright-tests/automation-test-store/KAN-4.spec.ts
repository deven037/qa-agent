import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const APP_EMAIL = process.env.APP_EMAIL ?? '';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';


test.describe('Login Feature', () => {
  test('TC-001: Valid Login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill(APP_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(BASE_URL + '/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome to Automation Test Store' })).not.toBeNull();
  });

  test('TC-002: Successful Login with Special Characters', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill(APP_EMAIL + '!@#$');
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD + '!@#$');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(BASE_URL + '/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome to Automation Test Store' })).not.toBeNull();
  });

  test('TC-003: Invalid Username', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill('invalid-email@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
  });

  test('TC-004: Invalid Password', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill(APP_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('invalid-password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
  });

  test('TC-005: Both Invalid Username and Password', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill('invalid-email@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('invalid-password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
  });

  test('TC-006: Empty Username', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill('');
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Username is required' })).not.toBeNull();
  });

  test('TC-007: Empty Password', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill(APP_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Password is required' })).not.toBeNull();
  });

  test('TC-008: Username Exceeding Maximum Length', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill('a'.repeat(256) + '@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Username exceeds maximum length' })).not.toBeNull();
  });

  test('TC-009: Password Exceeding Maximum Length', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill(APP_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('a'.repeat(256));
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Password exceeds maximum length' })).not.toBeNull();
  });

  test('TC-010: SQL Injection Attempt', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill("admin' OR '1'='1");
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
  });

  test('TC-011: Cross-Site Scripting (XSS) Attempt', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('textbox', { name: 'Email' }).fill('<script>alert("XSS")</script>');
    await page.getByRole('textbox', { name: 'Password' }).fill(APP_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
  });

  test('TC-012: Multiple Failed Login Attempts', async ({ page }) => {
    await page.goto(BASE_URL);
    for (let i = 0; i < 5; i++) {
      await page.getByRole('textbox', { name: 'Email' }).fill('invalid-email@example.com');
      await page.getByRole('textbox', { name: 'Password' }).fill('invalid-password');
      await page.getByRole('button', { name: 'Login' }).click();
      await expect(page.getByRole('alert', { name: 'Invalid username or password' })).not.toBeNull();
    }
    await expect(page.getByRole('alert', { name: 'Account locked due to multiple failed login attempts' })).not.toBeNull();
  });
});