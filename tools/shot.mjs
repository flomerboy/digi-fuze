// Screenshot / play-test a cartridge in real Chromium via the dev bench.
// Requires the dev server (npm run dev) on :5173.
// Usage: node tools/shot.mjs <cartId> <out-prefix> [script]
//   script: comma-separated steps. "wait:500" waits ms, "press:Enter" taps a key,
//           "hold:ArrowLeft:300" holds a key for ms, "shot" takes a screenshot.
//   default script: "wait:800,shot,press:Enter,wait:1500,shot,hold:ArrowRight:600,wait:1500,shot"
// Prints any page errors / cartridge crashes. Screenshots: <out-prefix>-N.png (the 320x240 screen, upscaled 2x).
import { chromium } from 'playwright';

const [cart, out = 'shot', script = 'wait:800,shot,press:Enter,wait:1500,shot,hold:ArrowRight:600,wait:1500,shot'] = process.argv.slice(2);
const base = process.env.VGR_URL || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[cart]')) errors.push(`console: ${m.text()}`); });
const isRemix = cart.startsWith('remix:');
await page.goto(`${base}/dev.html?${isRemix ? 'remix=' + cart.slice(6) : 'cart=' + cart}`);
await page.waitForTimeout(300);
let n = 0;
for (const step of script.split(',').map((s) => s.trim()).filter(Boolean)) {
  const [op, a, b] = step.split(':');
  if (op === 'wait') await page.waitForTimeout(Number(a));
  else if (op === 'press') { await page.keyboard.down(a); await page.waitForTimeout(60); await page.keyboard.up(a); }
  else if (op === 'hold') { await page.keyboard.down(a); await page.waitForTimeout(Number(b)); await page.keyboard.up(a); }
  else if (op === 'shot') {
    const file = `${out}-${++n}.png`;
    await page.locator('#screen').screenshot({ path: file, scale: 'css', style: 'canvas{width:640px!important;height:480px!important}' });
    console.log('saved', file);
  }
}
const crash = await page.locator('#err').textContent();
if (crash) errors.push(crash);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
