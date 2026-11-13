const { expect } = require('@playwright/test');

/**
 * Page object for the sign-in flow (hand-written baseline).
 *
 * LOCATORS ARE UNVERIFIED: they follow the common two-step sign-in pattern
 * (email -> Continue -> password -> Sign in) using accessible roles and labels.
 * Run `npm run inspect` against the real site and adjust the block below if
 * any of them do not match. They are all kept in this one block on purpose.
 */
class LoginPage {
  constructor(page) {
    this.page = page;
    // ---- locator block: edit here only ----
    this.signInLink = page.getByRole('link', { name: /sign[ -]?in|log[ -]?in/i }).first();
    this.emailInput = page.getByLabel(/email|mobile phone number|username/i).first();
    this.continueButton = page.getByRole('button', { name: /^continue$/i });
    this.passwordInput = page.getByLabel(/^password/i).first();
    this.signInButton = page.getByRole('button', { name: /sign[ -]?in|log[ -]?in/i }).last();
    // ---------------------------------------
  }

  async open() {
    await this.page.goto('/');
  }

  async goToSignIn() {
    await this.signInLink.click();
    await expect(this.emailInput).toBeVisible();
  }

  async login(email, password) {
    await this.emailInput.fill(email);

    // Two-step flow: the password field appears after "Continue".
    // If the site shows both fields at once, the Continue click is skipped.
    if (!(await this.passwordInput.isVisible())) {
      await this.continueButton.click();
    }

    await expect(this.passwordInput).toBeVisible();
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}

module.exports = { LoginPage };
