// Browser test for the editor: preview, stale state, diagnostics, stepping and a full season.
// Run with `npm run test:browser`. Waits on the page's own state, never on fixed delays.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test('preview and diagnostics follow the code and the field', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);

  const code = page.locator('#code');
  const status = page.locator('#status');
  const diag = page.locator('#diag');
  const field = page.locator('#field'); // data-preview is none, live or stale
  const day = page.locator('#sTick');

  // Valid code: a live preview, no diagnostics, no day spent.
  await code.fill('Harvest←{⍵≥3}');
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(diag).toHaveText('');

  // Start editing: the old preview goes stale straight away.
  await code.press('End');
  await code.press('Backspace');
  await expect(status).toHaveAttribute('data-state', 'editing');
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // The edit left invalid APL: quiet code error, old preview kept but stale.
  await expect(status).toHaveAttribute('data-state', 'code');
  await expect(diag).toContainText('ERROR');
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // Valid APL with an unusable result: reported as a result problem, not a code error.
  await code.fill('Harvest←{+/⍵}');
  await expect(status).toHaveAttribute('data-state', 'result');
  await expect(diag).toHaveText(/^Invalid result: /);
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // Recovery: live preview again and diagnostics cleared.
  await code.fill('Harvest←{⍵≥3}');
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(diag).toHaveText('');

  // None of that spent a day.
  await expect(day).toHaveText('0/100');

  // Stepping moves the field on and the preview is recalculated for the new day.
  await page.click('#step');
  await expect(day).toHaveText('1/100');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(status).toHaveAttribute('data-state', 'ready');

  // Stepping mid-edit: the preview stays stale until the pending edit settles.
  await code.press('End');
  await code.press('Space');
  await page.click('#step');
  await expect(day).toHaveText('2/100');
  await expect(field).toHaveAttribute('data-preview', 'stale');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(status).toHaveAttribute('data-state', 'ready');

  // Play out the season.
  await page.selectOption('#speed', '30');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText(/^Season over\. You scored \d+\.$/, { timeout: 30000 });
  await expect(day).toHaveText('100/100');

  // The season report appears, agrees with the scoreboard, and switches chart views.
  const report = page.locator('#report'), chart = page.locator('#chart');
  await expect(report).toBeVisible();
  await expect(page.locator('#rScore')).toHaveText(await page.locator('#sScore').textContent());
  await expect(page.locator('#rWasted')).toHaveText(await page.locator('#sWasted').textContent());
  await expect(chart).toHaveAttribute('data-view', 'score');
  await page.click('.seg button[data-view="rot"]');
  await expect(chart).toHaveAttribute('data-view', 'rot');
  await expect(page.locator('.seg button[data-view="rot"]')).toHaveAttribute('aria-pressed', 'true');
  await chart.focus();
  await chart.press('End');
  await expect(page.locator('#readout')).toHaveText(/^Day 100: \d+ ripe plots? lost to rot$/);

  // A new season hides the report.
  await page.click('#restart');
  await expect(report).toBeHidden();

  expect(errors).toEqual([]);
});

test('challenges keep separate personal bests that survive a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);

  const code = page.locator('#code'), status = page.locator('#status');
  const best = page.locator('#sBest'), msg = page.locator('#msg');
  const playSeason = async src => {
    await code.fill(src);
    await expect(status).toHaveAttribute('data-state', 'ready');
    await page.click('#restart');
    await page.click('#run');
    await expect(msg).toHaveText(/^Season over\./, { timeout: 30000 });
  };

  await page.selectOption('#season', 'the-long-harvest');
  await expect(page.locator('#newField')).toBeDisabled();
  await expect(best).toHaveText('–');
  await page.selectOption('#speed', '30');

  // First result: recorded, with no previous best to compare against.
  await playSeason('Harvest←{⍵≥3}');
  await expect(page.locator('#cmpThis')).toHaveText('1216');
  await expect(page.locator('#cmpStatus')).toHaveText('Your first result for this challenge.');
  await expect(best).toHaveText('1216');

  // A worse run doesn't replace it.
  await playSeason('Harvest←{⍵=3}');
  await expect(page.locator('#cmpPrev')).toHaveText('1216');
  await expect(page.locator('#cmpStatus')).toHaveText('Your personal best stays at 1216.');
  await expect(best).toHaveText('1216');

  // Bests and the chosen season survive a reload.
  await page.reload();
  await expect(page.locator('#season')).toHaveValue('the-long-harvest');
  await expect(best).toHaveText('1216');

  // Other challenges have their own bests, and practice has none to keep.
  await page.selectOption('#season', 'first-furrows');
  await expect(best).toHaveText('–');
  await page.selectOption('#season', 'practice');
  await expect(page.locator('#newField')).toBeEnabled();
  await expect(page.locator('#bestLabel')).toHaveText('Best on this field');

  expect(errors).toEqual([]);
});
