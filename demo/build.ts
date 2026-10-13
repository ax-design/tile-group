// Builds the demo into demo/dist: bun demo/build.ts
// The @ax-design packages resolve to sibling checkouts when they exist, else to node_modules.
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const sources: Record<string, string> = { '@ax-design/tile-group': resolve(import.meta.dir, '../src/index.ts') };
for (const name of ['surface', 'shape', 'typed-om', 'reveal-highlight', 'acrylic', 'elevation']) {
    const path = join(root, name, 'src/index.ts');
    if (existsSync(path)) sources[`@ax-design/${name}`] = path;
}

export async function build(): Promise<void> {
    rmSync(join(import.meta.dir, 'dist'), { recursive: true, force: true });
    const result = await Bun.build({
        entrypoints: [join(import.meta.dir, 'index.html')],
        outdir: join(import.meta.dir, 'dist'),
        plugins: [
            {
                name: 'ax-sources',
                setup(b) {
                    b.onResolve({ filter: /^@ax-design\// }, (args) => (sources[args.path] ? { path: sources[args.path] } : undefined));
                },
            },
        ],
    });
    if (!result.success) throw new Error(result.logs.join('\n'));
}

if (import.meta.main) await build();
