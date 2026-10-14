import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// In dev, also serve the Chog brain's Vercel functions (api/<name>.js), so chat works with `npm run dev`.
// Put ANTHROPIC_API_KEY in .env (never committed), or BRAIN_MOCK=1 to get canned replies without a key.
function devApi(env) {
  return {
    name: 'chog-dev-api',
    configureServer(server) {
      for (const k of ['ANTHROPIC_API_KEY', 'BRAIN_MOCK', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
        if (env[k] && !process.env[k]) process.env[k] = env[k];
      }
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/([a-z]+)$/.exec((req.url || '').split('?')[0]);
        if (!m) return next();
        try {
          const mod = await import(pathToFileURL(path.resolve('api', `${m[1]}.js`)).href);
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = err?.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      });
    },
  };
}

// The model packs (src/packs, loaded by src/assets.js) start downloading with the page instead of
// once the script has run. Build only: their names carry a hash.
function preloadPacks() {
  return {
    name: 'chog-preload-packs',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) =>
        Object.keys(ctx.bundle ?? {})
          .filter((f) => f.endsWith('.glb'))
          .map((f) => ({ tag: 'link', attrs: { rel: 'preload', href: `./${f}`, as: 'fetch', crossorigin: '' }, injectTo: 'head' })),
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  plugins: [devApi(loadEnv(mode, process.cwd(), '')), preloadPacks()],
}));
