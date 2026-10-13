// Demo server: bun run demo. Rebuilds on every page load, so a reload shows your changes.
import { join } from 'node:path';
import { build } from './build.ts';

const dist = join(import.meta.dir, 'dist');
const server = Bun.serve({
    port: Number(process.env.PORT || 3000),
    hostname: process.env.HOST || 'localhost',
    async fetch(req) {
        let path = new URL(req.url).pathname;
        if (path === '/' || path === '/index.html') {
            try {
                await build();
            } catch (error) {
                return new Response(String(error), { status: 500 });
            }
            path = '/index.html';
        }
        const file = Bun.file(join(dist, path));
        return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
    },
});
console.log(server.url.href);
