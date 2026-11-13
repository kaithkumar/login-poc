const { expect, test } = require('@playwright/test');
const { LoginPage } = require('../../pages/generated/LoginPage');

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
      await expect(login.passwordInput).toBeHidden();
      await expect(page).not.toHaveURL(/signin|login/i);
    });
  });
});
