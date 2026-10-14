# CLAUDE.md

This branch (`website`) is the public website for Epoch at epochgenealogy.app. It is an orphan
branch: the application lives on `main`. Read `README.md` first.

- **Stack:** SvelteKit 3 with `@sveltejs/adapter-cloudflare`, Svelte 5 runes, Node 24, deployed as
  a Worker (`cloudflare.config.ts`, deployed with `cf`). Every page is prerendered (`src/routes/+layout.ts`).
- **Imports** use the `#lib/*` package import (`package.json` `imports`); `$lib` is removed in
  Kit 3. Import TypeScript modules with a `.js` extension.
- **Brand:** follow the app's `DESIGN.md` (emerald binding, cream paper, stone inks, system sans,
  amber only for the action). `PRODUCT.md` lists what may be claimed: no invented users,
  testimonials, prices or benchmarks. The site's design direction is in
  `.impeccable/surfaces/src-routes-page-svelte.md`.
- **Copy** lives in `src/lib/site.ts`. Keep facts in step with the app's README on `main`.
- **Conventions** match the app: tabs, single quotes, 100 columns (`npm run format`); comments
  explain why; booleans start with `is`/`has`/`should`/…; Svelte components declare a `Props`
  interface with TSDoc per prop.
- **Commits:** Conventional Commits, small and focused, ending with a `Co-Authored-By` trailer for
  agent commits, as on `main`.
