const { expect, test } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

test.describe('Login', () => {
  test.skip(!email || !password, 'Set TEST_EMAIL and TEST_PASSWORD to run this test');

  test('TC-001: registered user can sign in with valid credentials', async ({ page }) => {
    const login = new LoginPage(page);

    await test.step('Open the home page', async () => {
      await login.open();
    });

    await test.step('Go to the sign-in page', async () => {
      await login.goToSignIn();
    });

    await test.step('Enter valid credentials and submit', async () => {
      await login.login(email, password);
    });

    await test.step('Verify the user is signed in', async () => {
      // The sign-in form must be gone, and we must have left the sign-in URL.
      await expect(login.passwordInput).toBeHidden();
      await expect(page).not.toHaveURL(/signin|sign-in|login/i);

      // Optional stronger check: set EXPECTED_GREETING to text that only a
      // signed-in user sees, for example "Hello, Asha".
      const greeting = process.env.EXPECTED_GREETING;
      if (greeting) {
        await expect(page.getByText(greeting)).toBeVisible();
      }
    });
  });
});
