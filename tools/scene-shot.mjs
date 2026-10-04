// Screenshot the full 3D app. Usage: node tools/scene-shot.mjs <out.png> [script]
// script steps: wait:ms, click:x:y (viewport px), drag:x1:y1:x2:y2, press:Key, shot:name, eval:js
import { chromium } from 'playwright';
const [out = 'scene.png', script = 'wait:2500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto((process.env.VGR_URL || 'http://localhost:5173/') + '?lowfi');
for (const step of script.split(',').map((s) => s.trim()).filter(Boolean)) {
  const [op, ...a] = step.split(':');
  if (op === 'wait') await page.waitForTimeout(Number(a[0]));
  else if (op === 'click') await page.mouse.click(Number(a[0]), Number(a[1]));
  else if (op === 'drag') { await page.mouse.move(+a[0], +a[1]); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(+a[0] + ((+a[2] - +a[0]) * i) / 12, +a[1] + ((+a[3] - +a[1]) * i) / 12); await page.waitForTimeout(16); } await page.mouse.up(); }
  else if (op === 'press') await page.keyboard.press(a[0]);
  else if (op === 'shot') { await page.screenshot({ path: a[0] }); console.log('saved', a[0]); }
  else if (op === 'eval') console.log(await page.evaluate(a.join(':')));
}
await page.screenshot({ path: out });
console.log('saved', out);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
