# epochgenealogy.app

The public website for [Epoch](https://github.com/tdack/epoch), a private family-tree application.
This branch (`website`) holds only the site; it shares no history with the application on `main`.

The site is one prerendered SvelteKit page, served by a Cloudflare Worker at
<https://epochgenealogy.app>. It links to the demo at <https://demo.epochgenealogy.app>.

## Running it

```sh
nvm use          # Node 24
npm install
npm run dev      # http://localhost:5173
```

| Command | Does |
|---|---|
| `npm run check` | Type-checks the Svelte and TypeScript |
| `npm run lint` | Checks formatting, then types |
| `npm run build` | Prerenders the site into `.svelte-kit/cloudflare`, then packages it into `.cloudflare/output` |
| `npm run preview` | Builds, then serves it locally with `vite preview` |
| `npm run deploy` | Builds and deploys to epochgenealogy.app |

## Deploying

`cloudflare.config.ts` binds the Worker to `epochgenealogy.app` as a custom domain, so Cloudflare
creates the DNS record and certificate on the first deploy. The `epochgenealogy.app` zone must
already be active on the account that deploys. Sign in once with `npx cf auth login`, then run
`npm run deploy`. `wrangler.config.ts` only tells the build where the SvelteKit adapter writes the
prerendered pages; the adapter reads it, so keep `vite.config.ts` pointing at it.

With Workers Builds, connect this repository, set the production branch to `website`, the build
command to `npm run build` and the deploy command to `npx cf deploy --prebuilt`.

## Where things are

- `src/lib/site.ts`: every link, the principles, the feature groups and the FAQ. Most copy
  changes happen here.
- `src/routes/+page.svelte`: the page and its sections.
- `src/lib/components/`: the hero, the family figure, the section connectors and the copyable
  command blocks. `EpochMark.svelte` is copied from the app; change the two together.
- `static/brand/`: the app's brand assets, copied from `main`.
- `static/views/`: recordings of the four 3D views, made in the demo
  (<https://demo.epochgenealogy.app>, the public "The Windsors" tree). Each clip selects
  Elizabeth, Alexandra, Mary Windsor so her ancestor and descendant lines are lit, then spins the
  view while a scripted hand orbits it, looks down on it and zooms in and out. 18.5 seconds of
  each take are played at 1.4× (about 13 seconds), 1280×538 h264 at CRF 26, with a `-poster.jpg`
  first frame. The browser capture leaves blocky patches in the near-black stage, so every pixel
  darker than R+G+B 72 is set to one colour (ffmpeg `geq`) before encoding. Re-record them when a
  view changes, and bump `CLIP_VERSION` in `src/lib/site.ts`: the edge cache keeps the old clips
  under their old URLs whatever the Worker deploys.
- `PRODUCT.md` and `DESIGN.md`: copies of the app's product and design context, which the site
  follows. The site's own design direction is in `.impeccable/surfaces/`.
