const { test, expect } = require('@playwright/test');

const APP = '/?mute=1';

async function boot(page, { unlockAll = true } = {}){
  await page.goto(APP);
  await page.waitForFunction(() => window.CF && CF.Engine);
  if (unlockAll){
    await page.evaluate(() => {
      const s = CF.Store.settings(); s.unlockAll = true; CF.Store.saveSettings(s);
      CF.renderHome();
    });
  }
}

async function startLevel(page, nodeKey, idx){
  await page.evaluate(([k, i]) => {
    const n = CF.NODES.find(n => n.key === k);
    CF.Engine.startLevel(n, n.levels[i]);
  }, [nodeKey, idx]);
}

// wait until an interactive (TEST/GENERALIZE) trial of the given kind is live
async function waitForInteractive(page, kind){
  await page.waitForFunction(k =>
    window.CF && CF.Engine.cur && CF.Engine.cur.kind === k && !CF.Engine.locked &&
    (CF.Engine.cur.state === 'TEST' || CF.Engine.cur.state === 'GENERALIZE'),
    kind, { timeout: 30000 });
  await page.waitForTimeout(500);   // let the appear animation finish
}

// drag with real pointer input; ends stationary so release velocity ≈ 0
async function dragTo(page, fromSel, tx, ty){
  const box = await page.locator(fromSel).boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.mouse.down();
  await page.mouse.move((box.x + box.width/2 + tx)/2, (box.y + box.height/2 + ty)/2, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.waitForTimeout(140);
  await page.mouse.move(tx, ty + 1);
  await page.mouse.up();
}

const dragEnds = page => page.evaluate(() =>
  (CF.Telemetry.session ? CF.Telemetry.session.events : [])
    .filter(e => e.type === 'DRAG_END')
    .map(e => ({ ok: e.isCorrectIntent, miss: e.missDistancePx })));

test('loads clean with five concept cards', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await boot(page, { unlockAll: false });
  await expect(page.locator('.ccard')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('identity 1.1: three correct taps master the level and advance', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'identity', 0);
  for (let i = 0; i < 3; i++){
    await waitForInteractive(page, 'tap');
    await page.locator('[data-target]').click();
  }
  await expect(page.locator('#view-home')).toBeVisible({ timeout: 15000 });
  const prog = await page.evaluate(() => CF.Store.progress().identity);
  expect(prog.mastered).toContain('1.1');
  expect(prog.levelIdx).toBe(1);
});

test('4.1: a ball released above the open box drops in', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'spatial', 0);
  await waitForInteractive(page, 'drag');
  const box = await page.locator('[data-el="box"]').boundingBox();
  await dragTo(page, '[data-el="ball"]', box.x + box.width/2, box.y - 60);
  await page.waitForFunction(() => CF.Engine.locked, null, { timeout: 8000 });
  const ends = await dragEnds(page);
  expect(ends[0]).toEqual({ ok: true, miss: 0 });
});

test('4.2 physics: centered drop lands on the base; past-edge drop rolls off', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'spatial', 1);

  await waitForInteractive(page, 'stack');
  let base = await page.locator('[data-el="base"]').boundingBox();
  await dragTo(page, '[data-el="block"]', base.x + base.width/2, base.y - 160);
  await page.waitForFunction(() => CF.Engine.locked, null, { timeout: 8000 });
  let ends = await dragEnds(page);
  expect(ends[0]).toEqual({ ok: true, miss: 0 });

  await waitForInteractive(page, 'stack');
  base = await page.locator('[data-el="base"]').boundingBox();
  await dragTo(page, '[data-el="block"]', base.x + base.width + 25, base.y - 160);
  await page.waitForFunction(() =>
    CF.Telemetry.session.events.filter(e => e.type === 'DRAG_END').length >= 2,
    null, { timeout: 8000 });
  ends = await dragEnds(page);
  expect(ends[1].ok).toBe(false);
  expect(ends[1].miss).toBeGreaterThan(0);
});

test('4.3: a missed star stays where it was set down (no zap-back)', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'spatial', 2);
  await waitForInteractive(page, 'drag');
  const stage = await page.locator('#stage').boundingBox();
  await dragTo(page, '[data-el="star"]', stage.x + stage.width*0.5, stage.y + stage.height*0.55);
  await page.waitForFunction(() => CF.Engine.wrongCount > 0, null, { timeout: 8000 });
  const left = await page.evaluate(() =>
    parseFloat(document.querySelector('[data-el="star"]').style.left));
  expect(Math.abs(left - 50)).toBeLessThan(4);
});

test('long-press opens the level picker; a card starts that level', async ({ page }) => {
  await boot(page);
  const card = page.locator('.ccard').first();
  const b = await card.boundingBox();
  await page.mouse.move(b.x + b.width/2, b.y + b.height/2);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await expect(page.locator('#level-picker')).toBeVisible();
  await expect(page.locator('.lp-card')).toHaveCount(5);
  await page.locator('.lp-card').nth(2).click();
  expect(await page.evaluate(() => CF.Engine.level.id)).toBe('1.3');
});

test('simulator generates sessions and the dashboard renders', async ({ page }) => {
  await boot(page);
  const res = await page.evaluate(() => {
    CF.Simulator.run('typical', 7);
    const sessions = CF.Store.sessions();
    return { count: sessions.length, insights: CF.computeInsights(sessions).length };
  });
  expect(res.count).toBeGreaterThan(5);
  expect(res.insights).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => { CF.renderDash(); CF.showView('dash'); });
  await expect(page.locator('.tile')).toHaveCount(4);
  await expect(page.locator('#chart-ttft svg')).toBeVisible();
});
