// Plain-node regression test for the Stage 5 personal launch-board calibration
// (session log regression) in public/index.html. No test framework/build step,
// matching the rest of this repo. Run with `npm test`.
//
// Extracts fitLaunchBoardRegression/fittedLaunchBoard straight out of the shipped
// HTML by source markers, so this always tests the real code rather than a copy
// that could drift out of sync.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function loadFns() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fnStart = html.indexOf('function fitLaunchBoardRegression');
  const fnEnd = html.indexOf('function scoreBallAgainst');
  if (fnStart === -1 || fnEnd === -1) {
    throw new Error('Could not locate fitLaunchBoardRegression in public/index.html — source markers moved.');
  }
  const src = html.slice(fnStart, fnEnd) + '\nmodule.exports = { fitLaunchBoardRegression, fittedLaunchBoard };';
  const modPath = path.join(__dirname, '.sessionLog.generated.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  fs.unlinkSync(modPath);
  return mod;
}

function run() {
  const { fitLaunchBoardRegression, fittedLaunchBoard } = loadFns();
  let passed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`ok - ${name}`);
    } catch (err) {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  test('no sessions: falls back to wall + 10', () => {
    assert.strictEqual(fitLaunchBoardRegression([]), null);
    assert.strictEqual(fittedLaunchBoard(9, []), 19);
    assert.strictEqual(fittedLaunchBoard(9, null), 19);
  });

  test('fewer than 5 sessions: still falls back to wall + 10', () => {
    const log = [
      { effWall: 8, confirmedLaunchBoard: 18 },
      { effWall: 9, confirmedLaunchBoard: 19 },
      { effWall: 10, confirmedLaunchBoard: 20 },
      { effWall: 11, confirmedLaunchBoard: 21 },
    ];
    assert.strictEqual(fitLaunchBoardRegression(log), null);
    assert.strictEqual(fittedLaunchBoard(9, log), 19);
  });

  test('5+ sessions with a known linear relationship: regression recovers slope/intercept', () => {
    // launchBoard = wall * 1.2 + 3, exactly, across 5 distinct wall values.
    const log = [7, 8, 9, 10, 11].map(wall => ({ effWall: wall, confirmedLaunchBoard: wall * 1.2 + 3 }));
    const fit = fitLaunchBoardRegression(log);
    assert.ok(fit, 'expected a fit once 5+ sessions are logged');
    assert.ok(Math.abs(fit.slope - 1.2) < 1e-9, `slope ${fit.slope} should be ~1.2`);
    assert.ok(Math.abs(fit.intercept - 3) < 1e-9, `intercept ${fit.intercept} should be ~3`);
    assert.strictEqual(fit.n, 5);
    assert.ok(Math.abs(fittedLaunchBoard(9, log) - (9 * 1.2 + 3)) < 1e-9);
  });

  test('5+ sessions with noisy (non-exact-linear) data: still returns a reasonable fit, no throw', () => {
    const log = [
      { effWall: 6, confirmedLaunchBoard: 16 },
      { effWall: 8, confirmedLaunchBoard: 17 },
      { effWall: 9, confirmedLaunchBoard: 20 },
      { effWall: 11, confirmedLaunchBoard: 20 },
      { effWall: 13, confirmedLaunchBoard: 24 },
    ];
    const fit = fitLaunchBoardRegression(log);
    assert.ok(fit);
    assert.ok(Number.isFinite(fit.slope) && Number.isFinite(fit.intercept));
  });

  test('zero wall-board variance (all identical): falls back to wall + 10 instead of dividing by zero', () => {
    const log = [1, 2, 3, 4, 5].map(() => ({ effWall: 9, confirmedLaunchBoard: 19 + Math.random() }));
    assert.strictEqual(fitLaunchBoardRegression(log), null);
    assert.strictEqual(fittedLaunchBoard(9, log), 19);
  });

  test('non-finite entries are ignored, not counted toward the 5-session threshold', () => {
    const log = [
      { effWall: 7, confirmedLaunchBoard: 17 },
      { effWall: 8, confirmedLaunchBoard: 18 },
      { effWall: 9, confirmedLaunchBoard: 19 },
      { effWall: NaN, confirmedLaunchBoard: 20 },
      { effWall: 10, confirmedLaunchBoard: undefined },
    ];
    assert.strictEqual(fitLaunchBoardRegression(log), null); // only 3 valid points
  });

  console.log(`\n${passed} passed`);
}

run();
