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
  await expect(page.locator('.ccard')).toHaveCount(9);   // Intro + 8 concept nodes
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
  await expect(page.locator('#stk-ops .fb-shape')).toHaveCount(8);
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
  // no cap: keep dropping well past the old 16 limit; buttons stay enabled
  await page.evaluate(() => { const g = CF.StackerGame; while (g.blocks.length < 30) g.drop(); });
  expect(await page.evaluate(() => CF.StackerGame.blocks.length)).toBe(30);
  await expect(page.locator('#stk-ops .fb-shape').first()).toBeEnabled();
  // reset clears the field
  await page.locator('#stk-reset').click();
  await expect(page.locator('#stacker-area .fb-block')).toHaveCount(0);
});

test('gear wall mini-game: spawn, mesh-snap, motor tri-switch drives exact ratios, reset', async ({ page }) => {
  await boot(page);
  await page.locator('.minicard[data-mini="gears"]').click();
  await expect(page.locator('#view-gears')).toBeVisible();
  await expect(page.locator('#gr-ops .gr-pick')).toHaveCount(9);   // 5 sizes + motor + steam engine + bell tower + cuckoo clock
  const r = await page.evaluate(async () => {
    const g = CF.GearGame;
    const m = g.spawn(-1, true);                     // motor (12t)
    m.x = 300; m.y = 380; g.syncOne(m);
    const a = g.spawn(3, false);                     // 20t, dropped a few px off mesh
    a.x = 300 + (12+20)*8/2 + 6; a.y = 384;
    // release path: snap + solve (what onUp does after a drag)
    const gw = await import('./js/games/gearworks.js');
    gw.snap(g.gears, g.gears.indexOf(a)); g.syncOne(a); g.solveNow();
    const rect = g.area().getBoundingClientRect();
    // quick tap on the motor hub cycles the tri-switch: off -> run
    g.onDown({ clientX: rect.left + m.x, clientY: rect.top + m.y, target: g.area() });
    g.onUp();
    const dist = Math.hypot(a.x - m.x, a.y - m.y);
    const t0 = { m: m.angle, a: a.angle };
    await new Promise(res => setTimeout(res, 500));
    const dm = m.angle - t0.m, da = a.angle - t0.a;
    // reverse: second tap
    g.onDown({ clientX: rect.left + m.x, clientY: rect.top + m.y, target: g.area() });
    g.onUp();
    const t1 = { m: m.angle };
    await new Promise(res => setTimeout(res, 300));
    return { sw1: 1, meshErr: Math.abs(dist - (12+20)*8/2), dm, ratio: da/dm,
             reversed: (m.angle - t1.m) < 0, count: g.gears.length };
  });
  expect(r.meshErr).toBeLessThan(1e-6);              // magnetic snap = exact mesh
  expect(r.dm).toBeGreaterThan(0.4);                 // the motor actually spins
  expect(Math.abs(r.ratio - (-12/20))).toBeLessThan(1e-6);   // exact gear ratio
  expect(r.reversed).toBe(true);                     // tri-switch third state
  // cuckoo clock: drive its input gear a full revolution -> the bird pops
  const cuckoo = await page.evaluate(async () => {
    const g = CF.GearGame, gw = await import('./js/games/gearworks.js');
    g.reset();
    const clock = g.spawn(-1, false, true);
    clock.x = 430; clock.y = 430; g.syncOne(clock);
    const m = g.spawn(-1, true);
    m.x = clock.x - (12+12)*8/2 - 4; m.y = 431;
    gw.snap(g.gears, g.gears.indexOf(m)); g.syncOne(m);
    m.sw = 1; g.refreshHub(m); g.solveNow();
    clock.acc = 6.2;                                 // a hair from one full turn
    await new Promise(res => setTimeout(res, 600));
    return { pops: clock.pops || 0, handGeared: !!clock.mHand.getAttribute('transform') };
  });
  expect(cuckoo.pops).toBeGreaterThanOrEqual(1);
  expect(cuckoo.handGeared).toBe(true);
  // bell tower: same drive contract — one ring per driven revolution
  const bell = await page.evaluate(async () => {
    const g = CF.GearGame, gw = await import('./js/games/gearworks.js');
    g.reset();
    const tower = g.spawn(-1, false, false, true);
    tower.x = 430; tower.y = 430; g.syncOne(tower);
    const m = g.spawn(-1, true);
    m.x = tower.x - (12+12)*8/2 - 4; m.y = 431;
    gw.snap(g.gears, g.gears.indexOf(m)); g.syncOne(m);
    m.sw = 1; g.refreshHub(m); g.solveNow();
    tower.acc = 6.2;
    await new Promise(res => setTimeout(res, 600));
    return { rings: tower.rings || 0 };
  });
  expect(bell.rings).toBeGreaterThanOrEqual(1);
  await page.locator('#gr-reset').click();
  expect(await page.evaluate(() => CF.GearGame.gears.length)).toBe(0);
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
  await expect(page.locator('.lp-card')).toHaveCount(6);   // Intro (first card): 5 taps + the spout
  await page.locator('.lp-card').nth(2).click();
  expect(await page.evaluate(() => CF.Engine.level.id)).toBe('0.3');
});

/* Memory deals face UP: the board starts as something the child watched, not
   as twenty-four identical backs. */
test('memory: 24 cards deal face up, then turn down together', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.MemoryGame.start());
  await expect(page.locator('#view-memory')).toBeVisible();
  await expect(page.locator('.mem-card')).toHaveCount(24);
  await expect(page.locator('.mem-card.mem-up')).toHaveCount(24);   // preview
  const names = await page.evaluate(() => [...document.querySelectorAll('.mem-card')].map(c => c.dataset.name));
  const counts = {};
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
  expect(Object.keys(counts).length).toBe(12);
  expect(Object.values(counts).every(v => v === 2)).toBe(true);
  await page.waitForFunction(() => CF.MemoryGame.running && !CF.MemoryGame.lock, null, { timeout: 15000 });
  await expect(page.locator('.mem-card.mem-up')).toHaveCount(0);
});

test('memory: a pair leaves the board for the pile; a mismatch turns back over', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.MemoryGame.start());
  await page.waitForFunction(() => CF.MemoryGame.running && !CF.MemoryGame.lock, null, { timeout: 15000 });
  const names = await page.evaluate(() => [...document.querySelectorAll('.mem-card')].map(c => c.dataset.name));
  const pair = [];
  const other = [];
  names.forEach((n, i) => { if (n === names[0]) pair.push(i); else if (!other.length) other.push(i); });
  // a mismatch: both turn back, nothing joins the pile
  await page.locator(`.mem-card[data-i="${pair[0]}"]`).click();
  await page.locator(`.mem-card[data-i="${other[0]}"]`).click();
  await page.waitForFunction(() => !CF.MemoryGame.lock, null, { timeout: 6000 });
  await expect(page.locator('.mem-card.mem-up')).toHaveCount(0);
  await expect(page.locator('.mem-chip')).toHaveCount(0);
  expect(await page.evaluate(() => CF.MemoryGame.misses)).toBe(1);
  // a match: both leave, one chip lands on the pile
  await page.locator(`.mem-card[data-i="${pair[0]}"]`).click();
  await page.locator(`.mem-card[data-i="${pair[1]}"]`).click();
  await page.waitForFunction(() => CF.MemoryGame.found === 1, null, { timeout: 6000 });
  await expect(page.locator('.mem-chip')).toHaveCount(1);
  await expect(page.locator('.mem-card.mem-gone')).toHaveCount(2);
  expect(await page.evaluate(() => CF.MemoryGame.misses)).toBe(0);   // a match resets help
});

/* Help arrives on its own, but only once he is actually stuck — and it points
   at the real partner. */
test('memory: the partner glows after repeated misses, not before', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => CF.MemoryGame.start());
  await page.waitForFunction(() => CF.MemoryGame.running && !CF.MemoryGame.lock, null, { timeout: 15000 });
  const names = await page.evaluate(() => [...document.querySelectorAll('.mem-card')].map(c => c.dataset.name));
  // first turn, no misses yet: nothing should glow
  await page.locator('.mem-card[data-i="0"]').click();
  await page.waitForTimeout(3000);
  await expect(page.locator('.mem-card.mem-hintcard')).toHaveCount(0);
  await page.locator('.mem-card[data-i="0"]').click();     // put it back
  // now miss twice
  const wrongs = [];
  for (let i = 0; i < names.length && wrongs.length < 2; i++)
    for (let j = i + 1; j < names.length; j++) if (names[i] !== names[j]){ wrongs.push([i, j]); break; }
  for (const [i, j] of wrongs){
    await page.locator(`.mem-card[data-i="${i}"]`).click();
    await page.locator(`.mem-card[data-i="${j}"]`).click();
    await page.waitForFunction(() => !CF.MemoryGame.lock, null, { timeout: 6000 });
  }
  await page.locator('.mem-card[data-i="0"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.mem-card.mem-hintcard').length === 1,
    null, { timeout: 6000 });
  expect(await page.evaluate(() => {
    const h = document.querySelector('.mem-card.mem-hintcard');
    return h.dataset.name === CF.MemoryGame.first.dataset.name && h !== CF.MemoryGame.first;
  })).toBe(true);
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
  await expect(page.locator('#all-levels .al-tile')).toHaveCount(40);   // 36 levels + 4 mini, one grid
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

test('intro 0.6: placing the bug on the spout triggers the wash-out effect', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'intro', 5);
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

test('letters 7.1: tapping the magnet letter says its name and advances', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 0);
  await waitForInteractive(page, 'tap');
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  // the letter carries its own character, which is what the reward speaks
  expect(await page.locator('[data-el="L"]').getAttribute('data-letter')).toMatch(/^[A-Z0-9]$/);
  const L = await page.locator('[data-el="L"]').boundingBox();
  await page.mouse.click(L.x + L.width/2, L.y + L.height/2);
  expect(await page.evaluate(() => CF.Engine.curRecord.firstAttemptCorrect)).toBe(true);
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 8000 });
});

test('letters 7.2: only the named letter counts; distractors never match its color', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 1);
  await waitForInteractive(page, 'tap');
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  // the named letter is on the sample card AND on the board — one of the
  // options is literally the same character
  const { sample, target, distractors } = await page.evaluate(() => ({
    sample: CF.Engine.cur.elements.find(e => e.sampleCard).letter,
    target: CF.Engine.cur.elements.find(e => e.target).letter,
    distractors: CF.Engine.cur.elements.filter(e => e.tappable && !e.target).map(e => e.letter),
  }));
  expect(target).toBe(sample);
  expect(distractors).not.toContain(target);   // no second copy of the answer
  const wrongId = await page.evaluate(() => CF.Engine.cur.elements.find(e => e.tappable && !e.target).id);
  const wrong = await page.locator(`[data-el="${wrongId}"]`).boundingBox();
  await page.mouse.click(wrong.x + wrong.width/2, wrong.y + wrong.height/2);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBe(idxBefore);   // wrong ⇒ no advance
  const right = await page.locator('[data-target]').boundingBox();
  await page.mouse.click(right.x + right.width/2, right.y + right.height/2);
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i, idxBefore, { timeout: 8000 });
});

/* 7.3 assembles the name by TAPPING — no letter is wrong, and the trial ends
   only when every one has flown to its spot. */
test('letters 7.3: tapping each letter flies it to its own spot and spells the name', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 2);
  await waitForInteractive(page, 'tapplace');
  const places = await page.evaluate(() => CF.Engine.cur.places.map(p => [p.el, p.slot]));
  expect(places.length).toBe(4);
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  for (const [pieceId, slotId] of places){
    const before = await page.evaluate(() => CF.Engine.trialIdx);
    expect(before).toBe(idxBefore);              // no early finish
    const p = await page.locator(`[data-el="${pieceId}"]`).boundingBox();
    await page.mouse.click(p.x + p.width/2, p.y + p.height/2);
    await page.waitForTimeout(700);
    // it landed on ITS spot, not somewhere near
    const gap = await page.evaluate(([a, b]) => {
      const r1 = document.querySelector(`[data-el="${a}"]`).getBoundingClientRect();
      const r2 = document.querySelector(`[data-el="${b}"]`).getBoundingClientRect();
      return Math.hypot(r1.x - r2.x, r1.y - r2.y);
    }, [pieceId, slotId]);
    expect(gap).toBeLessThan(4);
  }
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 10000 });
});

/* Tapping a letter that is already home repeats its name rather than doing
   nothing — the word stays available on demand. */
test('letters 7.3: re-tapping a placed letter says it again and does not advance', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 2);
  await waitForInteractive(page, 'tapplace');
  const pieceId = await page.evaluate(() => CF.Engine.cur.places[0].el);
  const box = await page.locator(`[data-el="${pieceId}"]`).boundingBox();
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await page.waitForTimeout(700);
  const idx = await page.evaluate(() => CF.Engine.trialIdx);
  const spot = await page.locator(`[data-el="${pieceId}"]`).boundingBox();
  await page.mouse.click(spot.x + spot.width/2, spot.y + spot.height/2);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBe(idx);
  expect(await page.locator(`[data-el="${pieceId}"]`).evaluate(el => el.classList.contains('placed'))).toBe(true);
});

test('letters 7.4: a letter dragged onto its own spot sticks; the wrong spot does not', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 3);
  await waitForInteractive(page, 'drag');
  const { pieceId, slotId, otherId } = await page.evaluate(() => {
    const p = CF.Engine.cur.pieces[0];
    const other = CF.Engine.cur.elements.find(e => /^g\d$/.test(e.id) && e.id !== p.slot);
    return { pieceId: p.el, slotId: p.slot, otherId: other ? other.id : null };
  });
  // the wrong spot rejects it — and the piece stays where it was set down
  const other = await page.locator(`[data-el="${otherId}"]`).boundingBox();
  await dragTo(page, `[data-el="${pieceId}"]`, other.x + other.width/2, other.y + other.height/2);
  await waitDragEnds(page, 1);
  expect((await dragEnds(page))[0].ok).toBe(false);
  expect(await page.locator(`[data-el="${pieceId}"]`).evaluate(el => el.classList.contains('placed'))).toBe(false);
  // its own spot takes it
  const slot = await page.locator(`[data-el="${slotId}"]`).boundingBox();
  await dragTo(page, `[data-el="${pieceId}"]`, slot.x + slot.width/2, slot.y + slot.height/2);
  await waitDragEnds(page, 2);
  expect((await dragEnds(page))[1].ok).toBe(true);
  expect(await page.locator(`[data-el="${pieceId}"]`).evaluate(el => el.classList.contains('placed'))).toBe(true);
});

/* Every SVG id in the app must be unique DOCUMENT-wide, not just within its
   own svg. The home screen is only display:none while playing — its node icons
   still own their ids, so a letter on the stage whose ids matched one in an
   icon resolved its gradients and clip into the hidden subtree and rendered as
   a bare shadow with an unclipped highlight. */
test('svg ids are unique across the whole document, hidden views included', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 3);          // the board: ghosts + letters + icons
  await waitForInteractive(page, 'drag');
  const dupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]'))
      seen.set(el.id, (seen.get(el.id) || 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  });
  expect(dupes).toEqual([]);
  // and every paint/clip reference actually resolves
  const broken = await page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('#stage [fill^="url("], #stage [clip-path^="url("]')){
      for (const a of ['fill', 'clip-path']){
        const v = n.getAttribute(a);
        const m = v && v.match(/^url\(#(.+?)\)/);
        if (m && !document.getElementById(m[1])) out.push(a + ':' + m[1]);
      }
    }
    return out;
  });
  expect(broken).toEqual([]);
});

/* A hand resting on the glass must not make the app go dead. "Primary" is just
   the first finger down, so if a palm is already touching, every real tap is
   non-primary — the child taps the right letter and nothing happens. */
test('a tap still counts while another finger is already resting on the screen', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 1);            // 7.2: tap the named letter
  await waitForInteractive(page, 'tap');
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  // a hand comes down on empty board first and STAYS down
  await page.evaluate(() => {
    const s = document.querySelector('#stage'), r = s.getBoundingClientRect();
    s.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'touch',
      isPrimary: true, clientX: r.left + 12, clientY: r.bottom - 12, bubbles: true }));
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => CF.Engine.trialIdx)).toBe(idxBefore);   // resting hand: no answer
  // now the real tap, which the OS reports as non-primary
  const t = await page.locator('[data-target]').boundingBox();
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 22, pointerType: 'touch',
      isPrimary: false, clientX: x, clientY: y, bubbles: true }));
  }, [t.x + t.width/2, t.y + t.height/2]);
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 8000 });
});

/* …and a palm landing on the board is not a wrong answer. It used to count as
   a miss, driving the fallback and the frustration detector while the child
   had not chosen anything. */
test('a hand on empty board is not scored as a miss', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 1);
  await waitForInteractive(page, 'tap');
  const stage = await page.locator('#stage').boundingBox();
  for (let i = 0; i < 3; i++){
    await page.mouse.click(stage.x + 10, stage.y + stage.height - 10);
    await page.waitForTimeout(220);
  }
  const st = await page.evaluate(() => ({
    wrong: CF.Engine.wrongCount, fallback: CF.Engine.usedFallback,
    first: CF.Engine.curRecord.firstAttemptCorrect }));
  expect(st.wrong).toBe(0);
  expect(st.fallback).toBe(false);
  expect(st.first).toBe(null);        // still no answer given
});

/* Several contacts at once — a grab, a palm — are one clumsy gesture, not
   several taps. */
test('simultaneous contacts count as one tap, not several', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 2);            // 7.3: four tappable letters
  await waitForInteractive(page, 'tapplace');
  const ids = await page.evaluate(() => CF.Engine.cur.places.map(p => p.el));
  const boxes = [];
  for (const id of ids) boxes.push(await page.locator(`[data-el="${id}"]`).boundingBox());
  // four fingers land across the letters within a few ms of each other
  await page.evaluate(pts => {
    pts.forEach(([x, y], i) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 40 + i, pointerType: 'touch',
        isPrimary: i === 0, clientX: x, clientY: y, bubbles: true }));
    });
  }, boxes.map(b => [b.x + b.width/2, b.y + b.height/2]));
  await page.waitForTimeout(900);
  const placed = await page.evaluate(ids =>
    ids.filter(id => document.querySelector(`[data-el="${id}"]`).classList.contains('placed')).length, ids);
  expect(placed).toBe(1);
});

/* Node 8 carries the tap-to-place idea onto a body. A garment must land on the
   part it belongs to — and since the child, the empty spots and the worn
   garments are one shared drawing, "landed" means the element sits exactly on
   its spot at any screen shape. */
test('dressing 8.2: each garment goes to its own part of the body', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'dressing', 1);
  await waitForInteractive(page, 'tapplace');
  const places = await page.evaluate(() => CF.Engine.cur.places.map(p => [p.el, p.slot]));
  expect(places.map(p => p[0]).sort()).toEqual(['hat', 'pants', 'shirt']);
  const idxBefore = await page.evaluate(() => CF.Engine.trialIdx);
  for (const [garment, spot] of places){
    const b = await page.locator(`[data-el="${garment}"]`).boundingBox();
    await page.mouse.click(b.x + b.width/2, b.y + b.height/2);
    await page.waitForTimeout(700);
    const gap = await page.evaluate(([a, c]) => {
      const r1 = document.querySelector(`[data-el="${a}"]`).getBoundingClientRect();
      const r2 = document.querySelector(`[data-el="${c}"]`).getBoundingClientRect();
      return Math.hypot(r1.x - r2.x, r1.y - r2.y);
    }, [garment, spot]);
    expect(gap).toBeLessThan(4);
  }
  await page.waitForFunction(i => !CF.Engine.active || CF.Engine.trialIdx > i,
    idxBefore, { timeout: 10000 });
});

/* A garment in the tray is the worn artwork pushed off-centre, so its box is
   much bigger than the cloth. Only the cloth may answer a tap, or a garment
   would swallow taps aimed at its neighbour. */
test('dressing: a tap between two garments hits neither', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'dressing', 2);           // 8.3: five garments, boxes overlap
  await waitForInteractive(page, 'tapplace');
  const ids = await page.evaluate(() => CF.Engine.cur.places.map(p => p.el));
  for (const id of ids)
    expect(await page.locator(`[data-el="${id}"]`).evaluate(el => el.classList.contains('painted-hit'))).toBe(true);
  // the gap between the first two tray items, vertically clear of the cloth
  const a = await page.locator(`[data-el="${ids[0]}"]`).boundingBox();
  await page.mouse.click(a.x + a.width / 2, a.y + 6);   // top edge of the box, above the garment
  await page.waitForTimeout(400);
  const placed = await page.evaluate(list =>
    list.filter(id => document.querySelector(`[data-el="${id}"]`).classList.contains('placed')).length, ids);
  expect(placed).toBe(0);
  expect(await page.evaluate(() => CF.Engine.wrongCount)).toBe(0);
});

/* iPad reality check: toddlers rest spare fingers on the glass mid-drag. A
   second pointer must not steal the piece, move it, or end the gesture. */
test('a second finger during a drag cannot hijack or end it', async ({ page }) => {
  await boot(page);
  await startLevel(page, 'letters', 3);
  await waitForInteractive(page, 'drag');
  const pieceId = await page.evaluate(() => CF.Engine.cur.pieces[0].el);
  const box = await page.locator(`[data-el="${pieceId}"]`).boundingBox();
  const sx = box.x + box.width/2, sy = box.y + box.height/2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy - 40);
  expect(await page.evaluate(() => !!CF.Engine.drag)).toBe(true);
  // a second, non-primary pointer taps and lifts elsewhere on the stage
  await page.evaluate(() => {
    const opts = { pointerId: 99, pointerType: 'touch', isPrimary: false, clientX: 60, clientY: 300, bubbles: true };
    document.querySelector('#stage').dispatchEvent(new PointerEvent('pointerdown', opts));
    window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 400 }));
    window.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  const stillDragging = await page.evaluate(() => !!CF.Engine.drag && CF.Engine.drag.el.dataset.el);
  expect(stillDragging).toBe(pieceId);   // same piece, still in hand
  await page.mouse.up();
  expect(await page.evaluate(() => !!CF.Engine.drag)).toBe(false);
});
