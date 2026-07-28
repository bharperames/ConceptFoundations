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

// drag with real pointer input; ends stationary so release velocity ≈ 0.
// Discrete moves with real delays: WebKit's driver interpolates `steps:` moves
// into sub-events delivered over time, and a quick pointerup truncates the
// stream mid-glide — the page would see the release far from the target.
async function dragTo(page, fromSel, tx, ty){
  const box = await page.locator(fromSel).boundingBox();
  const sx = box.x + box.width/2, sy = box.y + box.height/2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++){
    await page.mouse.move(sx + (tx - sx)*i/5, sy + (ty - sy)*i/5);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(120);
  await page.mouse.move(tx, ty);
  await page.waitForTimeout(60);
  await page.mouse.up();
}

const waitDragEnds = (page, n) => page.waitForFunction(want =>
  CF.Telemetry.session &&
  CF.Telemetry.session.events.filter(e => e.type === 'DRAG_END').length >= want,
  n, { timeout: 12000 });

const dragEnds = page => page.evaluate(() =>
  (CF.Telemetry.session ? CF.Telemetry.session.events : [])
    .filter(e => e.type === 'DRAG_END')
    .map(e => ({ ok: e.isCorrectIntent, miss: e.missDistancePx })));

test('loads clean with the concept cards', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await boot(page, { unlockAll: false });
  await expect(page.locator('.ccard')).toHaveCount(8);   // Intro + 7 concept nodes
  expect(errors).toEqual([]);
});

test('peekaboo 6.1: watch a card hide, then find it under the right cover', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'peekaboo', 0);
  // the hide sequence runs, then input unlocks
  await page.waitForFunction(() =>
    CF.Engine.cur && CF.Engine.cur.kind === 'hideseek' &&
    CF.Engine.cur.state === 'TEST' && !CF.Engine.locked, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const target = await page.evaluate(() => CF.Engine.cur.hideInto);
  const box = await page.locator(`[data-el="${target}"]`).boundingBox();
  await page.evaluate(([x, y]) => {
    document.elementFromPoint(x, y).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  }, [box.x + box.width/2, box.y + box.height/2]);
  expect(await page.evaluate(() => CF.Engine.curRecord.firstAttemptCorrect)).toBe(true);
});

test('peekaboo 6.3 shell game: covers shuffle, tapping the moved target still wins', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'peekaboo', 2);
  await page.waitForFunction(() =>
    CF.Engine.cur && CF.Engine.cur.kind === 'hideseek' && CF.Engine.cur.shuffle, null, { timeout: 30000 });
  // input unlocks only after the hide + full shuffle completes
  await page.waitForFunction(() => !CF.Engine.locked, null, { timeout: 25000 });
  await page.waitForTimeout(200);
  const target = await page.evaluate(() => CF.Engine.cur.hideInto);
  const box = await page.locator(`[data-el="${target}"]`).boundingBox();
  await page.evaluate(([x, y]) => {
    document.elementFromPoint(x, y).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  }, [box.x + box.width/2, box.y + box.height/2]);
  expect(await page.evaluate(() => CF.Engine.curRecord.firstAttemptCorrect)).toBe(true);
});

test('identity 1.1: mastering it auto-advances to the next level', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'identity', 0);
  for (let i = 0; i < 3; i++){
    await waitForInteractive(page, 'tap');
    await page.locator('[data-target]').click();
  }
  // after the celebration it rolls straight into 1.2 (no trip back home)
  await page.waitForFunction(() => CF.Engine.level && CF.Engine.level.id === '1.2', null, { timeout: 15000 });
  await expect(page.locator('#view-play')).toBeVisible();
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
  await waitDragEnds(page, 1);
  const ends = await dragEnds(page);
  expect(ends[0]).toEqual({ ok: true, miss: 0 });
});

test('4.2 physics: either block stacks on the other; past-edge rolls off', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'spatial', 1);

  await waitForInteractive(page, 'stack');
  let a = await page.locator('[data-el="blockA"]').boundingBox();
  await dragTo(page, '[data-el="blockB"]', a.x + a.width/2, a.y - 160);
  await waitDragEnds(page, 1);
  let ends = await dragEnds(page);
  expect(ends[0]).toEqual({ ok: true, miss: 0 });

  await waitForInteractive(page, 'stack');
  // this round, pick the OTHER block — neither is special
  const b = await page.locator('[data-el="blockB"]').boundingBox();
  await dragTo(page, '[data-el="blockA"]', b.x + b.width + 25, b.y - 160);
  await waitDragEnds(page, 2);
  ends = await dragEnds(page);
  expect(ends[1].ok).toBe(false);
  expect(ends[1].miss).toBeGreaterThan(0);
});

test('5.3 tower: the support surface rises as blocks stack', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'composition', 2);
  await waitForInteractive(page, 'stack');

  const base = await page.locator('[data-el="base"]').boundingBox();
  await dragTo(page, '[data-el="blockA"]', base.x + base.width/2, base.y - 150);
  await waitDragEnds(page, 1);
  // trial still live here: geometry is stable — A rests on the base
  const a = await page.locator('[data-el="blockA"]').boundingBox();
  expect(Math.abs((a.y + a.height) - base.y)).toBeLessThan(6);

  await dragTo(page, '[data-el="blockB"]', a.x + a.width/2, a.y - 150);
  await waitDragEnds(page, 2);
  const ends = await dragEnds(page);
  expect(ends.map(e => e.ok)).toEqual([true, true]);
});

test('5.3 tower: blocks stack anywhere and a pair moves as a group', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'composition', 2);
  await waitForInteractive(page, 'stack');

  // build a sub-stack on the floor, ignoring the base entirely
  let a = await page.locator('[data-el="blockA"]').boundingBox();
  await dragTo(page, '[data-el="blockB"]', a.x + a.width/2, a.y - 150);
  await waitDragEnds(page, 1);
  let ends = await dragEnds(page);
  expect(ends[0].ok).toBe(true);           // landed on the other loose block
  expect(await page.evaluate(() => CF.Engine.locked)).toBe(false);  // not done yet
  // trial still live: the sub-stack geometry is stable — B rests on A
  a = await page.locator('[data-el="blockA"]').boundingBox();
  const sb = await page.locator('[data-el="blockB"]').boundingBox();
  expect(Math.abs((sb.y + sb.height) - a.y)).toBeLessThan(8);
  expect(await page.evaluate(() => CF.Engine.stackOn.blockB)).toBe('blockA');

  // grab the BOTTOM of the pair and carry both onto the base → complete
  const base = await page.locator('[data-el="base"]').boundingBox();
  await dragTo(page, '[data-el="blockA"]', base.x + base.width/2, base.y - 170);
  await waitDragEnds(page, 2);
  ends = await dragEnds(page);
  expect(ends[1].ok).toBe(true);           // the carried pair landed on the base
});

test('block stacker mini-game: per-shape drop, grab-move, cap, reset', async ({ page }) => {
  await boot(page);
  // force the simple-physics fallback so the test is deterministic regardless of
  // whether the Matter.js CDN loaded in this environment
  await page.evaluate(() => { window.Matter = undefined; CF.StackerGame.start(); });
  await expect(page.locator('#view-stacker')).toBeVisible();
  // one drop button per shape (a picker row), not a single random button
  await expect(page.locator('#stk-ops .fb-shape')).toHaveCount(7);
  // clicking a shape icon drops that block
  await page.locator('#stk-ops .fb-shape[data-shape="0"]').click();
  await expect(page.locator('#stacker-area .fb-block')).toHaveCount(1);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) CF.StackerGame.drop(); });
  await expect(page.locator('#stacker-area .fb-block')).toHaveCount(4);
  // a settled block can be grabbed and moved (the whole point of the sandbox)
  const grab = await page.evaluate(() => {
    const g = CF.StackerGame, b = g.blocks[0], r = g.area().getBoundingClientRect();
    b.done = true; b.held = false; b.y = g.floorY - b.h/2;
    g.onDown({ clientX: r.left + b.x, clientY: r.top + b.y, target: g.area() });
    const held = !!(g.drag && g.drag.b === b && b.held);
    const x0 = b.x;
    g.onMove({ clientX: r.left + b.x + 90, clientY: r.top + b.y });
    const dx = b.x - x0;
    g.onUp();
    return { held, dx, released: !g.drag && !b.held };
  });
  expect(grab.held).toBe(true);
  expect(grab.dx).toBeGreaterThan(50);
  expect(grab.released).toBe(true);
  // fill to the cap; the drop buttons disable and refuse more
  const cap = await page.evaluate(() => { const g = CF.StackerGame; while (g.blocks.length < g.MAX) g.drop(); g.drop(); return g.MAX; });
  expect(await page.evaluate(() => CF.StackerGame.blocks.length)).toBe(cap);
  await expect(page.locator('#stk-ops .fb-shape').first()).toBeDisabled();
  // reset clears the field
  await page.locator('#stk-ops .fb-reset').click();
  await expect(page.locator('#stacker-area .fb-block')).toHaveCount(0);
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
  await expect(page.locator('.lp-card')).toHaveCount(5);   // Intro (first card) has 5 taps
  await page.locator('.lp-card').nth(2).click();
  expect(await page.evaluate(() => CF.Engine.level.id)).toBe('0.3');
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

test('bubble pop: popping scores, a grounded bubble ends the round', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.BubbleGame.start());
  await expect(page.locator('#view-bubbles')).toBeVisible();
  await page.waitForFunction(() => CF.BubbleGame.bubbles.length > 0, null, { timeout: 10000 });
  const score = await page.evaluate(() => {
    const g = CF.BubbleGame, b = g.bubbles[g.bubbles.length - 1];
    g.hit(b.x, b.y);
    return g.score;
  });
  expect(score).toBe(1);
  // a bubble reaching the ground ends the round
  await page.evaluate(() => {
    const g = CF.BubbleGame;
    g.bubbles.push({ x: g.W/2, y: g.ground - 1, r: 30, vy: 200, wobA: 0, wobF: 1, phase: 0, hue: 200, t: 0 });
  });
  await page.waitForFunction(() => !CF.BubbleGame.running, null, { timeout: 3000 });
  await expect(page.locator('#bub-over')).toBeVisible();
  expect(await page.locator('#bub-final').textContent()).toBe('1');
});

test('all-levels toggles as a home mode with one dense grid of every level', async ({ page }) => {
  await boot(page);   // unlockAll → everything reachable
  // toggle ON — no page change; the home swaps to the dense all-levels grid
  await page.locator('#btn-map').click();
  await expect(page.locator('#view-home')).toHaveClass(/levels-mode/);
  await expect(page.locator('#concept-grid')).toBeHidden();
  await expect(page.locator('#all-levels .al-grid')).toBeVisible();
  await expect(page.locator('#all-levels .al-tile')).toHaveCount(34);   // 31 levels + 3 mini, one grid
  await expect(page.locator('#btn-map .bm-label')).toHaveText('Games');
  // toggle OFF — back to the concept-card view (still the home screen)
  await page.locator('#btn-map').click();
  await expect(page.locator('#view-home')).not.toHaveClass(/levels-mode/);
  await expect(page.locator('#concept-grid')).toBeVisible();
  // a tile jumps straight into that level
  await page.locator('#btn-map').click();
  await page.locator('#all-levels .al-tile[data-node="peekaboo"][data-i="0"]').click();
  await expect(page.locator('#view-play')).toBeVisible();
  expect(await page.evaluate(() => CF.Engine.level.id)).toBe('6.1');
});

test('picture puzzle: build all three pictures to fill the shelf, then win', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.PuzzleGame.start());
  await expect(page.locator('#view-puzzle')).toBeVisible();
  await expect(page.locator('.puz-tile')).toHaveCount(9);
  await expect(page.locator('.puz-face')).toHaveCount(27);   // 9 tiles x 3 faces
  await expect(page.locator('#puz-gallery .puz-slot')).toHaveCount(3);   // an empty shelf slot per scene
  // a tap advances that tile's face by one (mod 3)
  const f0 = await page.evaluate(() => CF.PuzzleGame.tiles[0].f);
  await page.evaluate(() => CF.PuzzleGame.rotate(CF.PuzzleGame.tiles[0]));
  expect(await page.evaluate(() => CF.PuzzleGame.tiles[0].f)).toBe((f0 + 1) % 3);

  // build each of the three distinct scenes; each completion pops a trophy onto
  // the shelf, and the finale overlay stays hidden until all three are done
  for (let scene = 0; scene < 3; scene++){
    await page.waitForFunction(() => CF.PuzzleGame.won === false);
    await page.evaluate(s => CF.PuzzleGame.tiles.forEach(t => { t.f = s; t.deg = -120*s; }), scene);
    expect(await page.evaluate(() => CF.PuzzleGame.solved())).toBe(true);
    await page.evaluate(() => CF.PuzzleGame.complete());
    await expect(page.locator('.puz-slot.filled')).toHaveCount(scene + 1, { timeout: 3000 });
    if (scene < 2) await expect(page.locator('#puz-win')).toBeHidden();
  }
  // all three built → the finished pictures are carried into the fireworks
  // celebration (stay on screen over the animation), then the play-again card
  await expect(page.locator('.cel-pics .cel-pic')).toHaveCount(3, { timeout: 4000 });
  await expect(page.locator('#puz-win')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.puz-slot.filled')).toHaveCount(3);
});

test('picture puzzle: rebuilding a completed picture pulses its trophy', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.PuzzleGame.start());
  // build scene 1 once → its shelf slot fills
  await page.waitForFunction(() => CF.PuzzleGame.won === false);
  await page.evaluate(() => CF.PuzzleGame.tiles.forEach(t => { t.f = 1; t.deg = -120; }));
  await page.evaluate(() => CF.PuzzleGame.complete());
  await expect(page.locator('#puz-gallery .puz-slot[data-scene="1"].filled')).toBeVisible({ timeout: 3000 });
  // next round: build scene 1 AGAIN → the existing trophy pulses (not a new fill)
  await page.waitForFunction(() => CF.PuzzleGame.won === false);
  await page.evaluate(() => CF.PuzzleGame.tiles.forEach(t => { t.f = 1; t.deg = -120; }));
  await page.evaluate(() => CF.PuzzleGame.complete());
  await page.waitForFunction(() =>
    document.querySelector('#puz-gallery .puz-slot[data-scene="1"]').classList.contains('pulse'),
    { timeout: 3000 });
  // still only one picture collected, no finale
  expect(await page.evaluate(() => CF.PuzzleGame.done.size)).toBe(1);
  await expect(page.locator('#puz-win')).toBeHidden();
});

test('intro: tapping the thing plays its effect and advances', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'intro', 0);              // 0.1 pop the bubble
  await waitForInteractive(page, 'tap');
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  const thing = await page.locator('[data-el="thing"]').boundingBox();
  await page.mouse.click(thing.x + thing.width/2, thing.y + thing.height/2);
  expect(await page.evaluate(() => CF.Engine.curRecord.firstAttemptCorrect)).toBe(true);
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 8000 });
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBeGreaterThan(idxBefore);
});

test('causality 7.1: placing the bug on the spout triggers the wash-out effect', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'causality', 0);
  await waitForInteractive(page, 'drag');
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  const spout = await page.locator('[data-el="spout"]').boundingBox();
  await dragTo(page, '[data-el="bug"]', spout.x + spout.width/2, spout.y + spout.height*0.78);
  await waitDragEnds(page, 1);
  const ends = await dragEnds(page);
  expect(ends[0].ok).toBe(true);   // dropping the bug on the spout is the cause
  expect(await page.evaluate(() => CF.Engine.curRecord.firstAttemptCorrect)).toBe(true);
  // the effect locks input during the full itsy-bitsy song (climb → rain → wash
  // out → sun → climb again, ~8s); the trial must then COMPLETE and advance
  // (regression: the lock used to swallow it, so spout levels never progressed)
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 15000 });
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBeGreaterThan(idxBefore);
});

async function whichButtonTest(page, levelIdx, nButtons){
  await boot(page);
  await startLevel(page, 'causality', levelIdx);
  await waitForInteractive(page, 'tap');
  await expect(page.locator('#stage [data-el^="b"].tappable')).toHaveCount(nButtons);
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  const wrongId = await page.evaluate(() => CF.Engine.cur.elements.find(e => e.tappable && !e.target).id);
  const rightId = await page.evaluate(() => CF.Engine.cur.elements.find(e => e.target).id);
  const wrong = await page.locator(`[data-el="${wrongId}"]`).boundingBox();
  await page.mouse.click(wrong.x + wrong.width/2, wrong.y + wrong.height/2);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBe(idxBefore);   // wrong ⇒ no advance
  const right = await page.locator(`[data-el="${rightId}"]`).boundingBox();
  await page.mouse.click(right.x + right.width/2, right.y + right.height/2);
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i, idxBefore, { timeout: 8000 });
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBeGreaterThan(idxBefore);
}

test('causality 7.2: two buttons — only the effective one makes it go', async ({ page }) => {
  await whichButtonTest(page, 1, 2);
});

test('causality 7.3: three buttons — discriminate the cause', async ({ page }) => {
  await whichButtonTest(page, 2, 3);
});
