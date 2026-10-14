#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p pwd
: "${CAPTURE_URL:?Set CAPTURE_URL to the exact preview URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to the screenshot output directory.}"
RUNNER_TEMP="${RUNNER_TEMP:-/home/runner/work/_temp}"
RUNTIME_PM="${HOME}/.local/share/omgithub-playwright"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR" "$RUNNER_TEMP"
/usr/bin/time -p node --version
if [[ -z "${DISPLAY:-}" && -s "$RUNTIME_PM/display" ]]; then
  export DISPLAY=":$(/usr/bin/time -p cat "$RUNTIME_PM/display")"
fi
HELPER="$RUNNER_TEMP/capture-helper-$(date +%s).cjs"
/usr/bin/time -p cat > "$HELPER" <<'NODEEOF'
const { mkdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const url = process.env.CAPTURE_URL, output = process.env.CAPTURE_DIR;
if (!url || !output) { console.error('Set CAPTURE_URL and CAPTURE_DIR.'); process.exit(1); }
mkdirSync(output, { recursive: true });
const TEMP = code => { const e = new Error('transient'); e.exitCode = code; return e; };
let playwright;
try { playwright = require(process.env.HOME + '/.local/share/omgithub-playwright/node_modules/playwright'); }
catch (e) { console.error('playwright module missing: ' + e.message); process.exit(1); }
const { chromium } = playwright;
(async () => {
  let browser;
  try {
    const headed = !!process.env.DISPLAY;
    if (headed) {
      browser = await chromium.launch({ channel: 'chromium', headless: false, timeout: 30000 })
        .catch(async () => await chromium.launch({ headless: false, timeout: 30000 }))
        .catch(e => { throw Object.assign(e, { exitCode: 75 }); });
    } else {
      browser = await chromium.launch({ headless: true, timeout: 30000 })
        .catch(e => { throw Object.assign(e, { exitCode: 75 }); });
    }
  } catch (e) { console.error('browser launch failed: ' + (e.message || e)); process.exit(e.exitCode || 75); }
  const views = [['desktop', 1440, 900], ['mobile', 390, 844]];
  try {
    for (const [name, width, height] of views) {
      const page = await browser.newPage({ viewport: { width, height } }).catch(e => { throw Object.assign(e, { exitCode: 75 }); });
      page.setDefaultTimeout(30000);
      page.on('pageerror', e => console.error(`pageerror ${name}: ${e.message}`));
      let response;
      try { response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }); }
      catch (e) { await page.close().catch(() => {}); throw Object.assign(e, { exitCode: 75 }); }
      const status = response ? response.status() : 0;
      if (!response || !response.ok()) {
        await page.close().catch(() => {});
        const transient = !response || [408, 429, 500, 502, 503, 504].includes(status);
        console.error(`HTTP ${status} loading ${url}`);
        throw Object.assign(new Error(`HTTP ${status}`), { exitCode: transient ? 75 : 1 });
      }
      try {
        await page.locator('body').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await page.waitForTimeout(2500);
      } catch (e) { await page.close().catch(() => {}); console.error(`render wait failed (${name}): ${e.message}`); throw Object.assign(e, { exitCode: 1 }); }
      const path = join(output, `final-${name}.png`);
      try { await page.screenshot({ path, timeout: 30000 }); }
      catch (e) {
        await page.close().catch(() => {});
        if (e.name === 'TimeoutError' || (browser && !browser.isConnected())) throw Object.assign(e, { exitCode: 75 });
        throw Object.assign(e, { exitCode: 1 });
      }
      const size = statSync(path).size;
      console.log(`captured ${name}: ${path} (${size} bytes)`);
      if (size < 5000) { await page.close().catch(() => {}); console.error(`${name} screenshot suspiciously small (${size}B)`); throw Object.assign(new Error('blank render'), { exitCode: 1 }); }
      await page.close();
    }
  } catch (e) { console.error(e.message || e); process.exitCode = e.exitCode || 1; }
  finally { await browser.close().catch(e => { console.error('browser close: ' + e.message); process.exitCode = process.exitCode || 75; }); }
})();
NODEEOF
/usr/bin/time -p node "$HELPER"
STATUS=$?
/usr/bin/time -p ls -la "$CAPTURE_DIR"
/usr/bin/time -p rm -f "$HELPER"
exit $STATUS
