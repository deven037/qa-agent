# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: automation-test-store/KAN-5.spec.ts >> Login and Navigation >> TC-001: Successful Login and Navigation to Home Page
- Location: playwright-tests/automation-test-store/KAN-5.spec.ts:9:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Login' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: Q
      - generic [ref=e6]: QA Agent
      - generic [ref=e7]: Sign in to your account
    - generic [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]:
          - generic [ref=e11]: Email
          - textbox "Email" [ref=e12]
        - generic [ref=e13]:
          - generic [ref=e14]: Password
          - textbox "Password" [ref=e15]
        - button "Sign in" [ref=e16]
      - paragraph [ref=e17]:
        - text: No account?
        - link "Create one" [ref=e18] [cursor=pointer]:
          - /url: /register
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e24] [cursor=pointer]:
    - img [ref=e25]
  - alert [ref=e28]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const BASE_URL = process.env.BASE_URL ?? '';
  4  | const APP_EMAIL = process.env.APP_EMAIL ?? '';
  5  | const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
  6  | 
  7  | 
  8  | test.describe('Login and Navigation', () => {
  9  |   test('TC-001: Successful Login and Navigation to Home Page', async ({ page }) => {
  10 |     await page.goto(BASE_URL);
> 11 |     await page.getByRole('link', { name: 'Login' }).click();
     |                                                     ^ Error: locator.click: Test timeout of 30000ms exceeded.
  12 |     await page.getByLabel('Email').fill(APP_EMAIL);
  13 |     await page.getByLabel('Password').fill(APP_PASSWORD);
  14 |     await page.getByRole('button', { name: 'Login' }).click();
  15 |     await expect(page.getByRole('navigation', { name: 'Left panel' })).toBeVisible();
  16 |     await page.getByRole('link', { name: 'Home' }).click();
  17 |     await expect(page.getByRole('main')).toContainText('Automation Test Store');
  18 |     await expect(page.url()).toBe(`${BASE_URL}/home`);
  19 |   });
  20 | });
```