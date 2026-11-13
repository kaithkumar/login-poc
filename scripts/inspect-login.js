const { chromium } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');

/**
 * Discovery step of the POC: open the site, click the sign-in link, and dump
 * what a script could interact with. Run it, then check the output against the
 * locator block in pages/LoginPage.js.
 *
 *   BASE_URL=https://amazon.ai npm run inspect
 */
const baseUrl = process.env.BASE_URL || 'https://amazon.ai';
const outDir = 'inspect-output';

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(baseUrl);
  await page.screenshot({ path: `${outDir}/1-home.png`, fullPage: true });
  console.log('Home page title:', await page.title());

  const signIn = page.getByRole('link', { name: /sign[ -]?in|log[ -]?in/i }).first();
  if (await signIn.count()) {
    await signIn.click();
    await page.waitForLoadState('domcontentloaded');
  } else {
    console.log('No sign-in link found on the home page; check the screenshot.');
  }

  console.log('Sign-in page URL:', page.url());
  await page.screenshot({ path: `${outDir}/2-signin.png`, fullPage: true });

  const snapshot = await page.locator('body').ariaSnapshot();
  writeFileSync(`${outDir}/signin-aria-snapshot.yml`, snapshot);
  console.log(`\n--- Accessibility snapshot of sign-in page ---\n${snapshot}`);
  console.log(`\nSaved screenshots and snapshot to ./${outDir}/`);

  await browser.close();
})();
