// Records the layout of WinJS (CellSpanningLayout of the ListView, Microsoft's layout for
// Windows 8 apps) for random tile lists, as fixtures for test/layout.test.ts.
// Usage: bun test/oracle/generate.ts. Needs Chromium from Playwright.
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dir, '../..');
const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(root, path === '/' ? 'test/oracle/winjs.html' : path));
        return (await file.exists()) ? new Response(file) : new Response('', { status: 404 });
    },
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2100, height: 800 } });
await page.goto(`http://127.0.0.1:${server.port}/`);

// A fixed seed, so the fixtures only change when this script does.
let seed = 20261013;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cases: { rows: number; items: number[][] }[] = [];
for (let k = 0; k < 300; k++) {
    const rows = 2 + Math.floor(rand() * 7);
    const n = 1 + Math.floor(rand() * 30);
    cases.push({ rows, items: Array.from({ length: n }, () => [1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4), rand() < 0.08 ? 1 : 0]) });
}
const results = await page.evaluate(async (list) => {
    const out = [];
    for (const c of list) out.push((await (window as any).layoutOf(c.items, c.rows)).out);
    return out;
}, cases);
const fixtures = cases.map((c, i) => ({ ...c, winjs: results[i] }));
await Bun.write(join(import.meta.dir, 'winjs-fixtures.json'), JSON.stringify(fixtures) + '\n');
console.log(`recorded ${fixtures.length} layouts`);
await browser.close();
server.stop();
