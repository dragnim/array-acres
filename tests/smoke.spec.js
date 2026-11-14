// A short smoke suite of the main journeys, run in Chromium, Firefox and WebKit (Safari's engine). The full
// suite, in browser.spec.js, runs in Chromium only.
const { test, expect } = require('@playwright/test');

const GAME = 'http://localhost:4173/index.html';
const LEADERBOARD = 'https://array-acres-leaderboard.long-tree-e1ed.workers.dev';
test.beforeEach(async ({ page }) => {
  await page.route(`${LEADERBOARD}/**`, route => route.fulfill({ json: { entries: [], pending: [] } }));
});
// A returning player on Middlebourne Farm, past the title screen.
const onMiddlebourne = async page => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('acres:help-seen')) { localStorage.setItem('acres:help-seen', '1'); localStorage.setItem('acres:farm', 'middlebourne-farm'); }
    sessionStorage.setItem('acres:welcomed', '1');
  });
  await page.goto(GAME);
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
};

test('a first visit: the title screen leads into the tutorial, whose first steps work', async ({ page }) => {
  await page.goto(GAME);
  await expect(page.locator('#welcome')).toBeVisible();
  await page.click('#welcomeStart');
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#tutStep')).toHaveText('Tutorial, step 1 of 12');
  for (let i = 0; i < 3; i++) await page.click('#tutNext');
  for (const word of ['⍵', '=', 'Ripe']) await page.locator('#words button', { hasText: new RegExp(`${word}$`) }).click();
  await expect(page.locator('#hBody')).toHaveValue('⍵=Ripe');
  await expect(page.locator('#tutNext')).toBeEnabled();
  await page.click('#tutNext'); await page.click('#tutNext');
  await page.click('#step');
  await expect(page.locator('#tutMsg')).toContainText('Day 1: you harvested 4 plots, scoring 4 points.');
  // The step is saved: a reload resumes it.
  await page.reload();
  await expect(page.locator('#tutStep')).toHaveText('Tutorial, step 6 of 12');
});

test('typing code updates the preview, and a whole season plays to the end', async ({ page }) => {
  await onMiddlebourne(page);
  await page.locator('#hBody').fill('');
  await page.locator('#hBody').pressSequentially('⍵=Ripe');
  await expect(page.locator('#hBody')).toHaveValue('⍵=Ripe');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#field')).toHaveAttribute('data-preview', 'live');
  await page.selectOption('#speed', '30');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText('Season complete. You scored 1213 points.', { timeout: 60000 });
});

test('the side panels open and close, and code and theme survive a reload', async ({ page }) => {
  await onMiddlebourne(page);
  await page.click('#openHelp');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#panelTitle')).toHaveText('How to play');
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel')).toBeHidden();
  await page.locator('#hBody').fill('⍵≥Ripe');
  await page.click('#themeToggle');
  const theme = await page.locator('html').getAttribute('data-theme');
  expect(['light', 'dark']).toContain(theme);
  await page.reload();
  await expect(page.locator('#hBody')).toHaveValue('⍵≥Ripe');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});
