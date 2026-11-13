const { test } = require('@playwright/test');

// Seed used by the planner and generator agents (Copilot setup): opens the base URL
// so they start from a fresh, signed-out page. BASE_URL comes from playwright.config.js.
test('seed', async ({ page }) => {
  await page.goto('/');
});
