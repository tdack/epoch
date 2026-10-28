# epochgenealogy.app

The public website for [Epoch](https://github.com/tdack/epoch), a private family-tree application.
This branch (`website`) holds only the site; it shares no history with the application on `main`.

The site is five prerendered SvelteKit pages (home, reports, maps, roles and sub-trees), served by a
Cloudflare Worker at
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
| `npm run deploy:preview` | Builds and uploads a preview of the current branch, without deploying |

## Deploying

`cloudflare.config.ts` binds the Worker to `epochgenealogy.app` as a custom domain, so Cloudflare
creates the DNS record and certificate on the first deploy. The `epochgenealogy.app` zone must
already be active on the account that deploys. Sign in once with `npx cf auth login`, then run
`npm run deploy`. `wrangler.config.ts` only tells the build where the SvelteKit adapter writes the
prerendered pages; the adapter reads it, so keep `vite.config.ts` pointing at it.

With Workers Builds, connect this repository, set the production branch to `website`, the build
command to `npm run build` and the deploy command to `npx cf deploy --prebuilt`.

To check a branch before it reaches the site, run `npm run deploy:preview` on it. It uploads a
version without deploying it, under an alias made from the branch name, and prints its address,
`https://<branch>-epoch-website.<subdomain>.workers.dev`. Production stays on the custom domain
only. Preview URLs are a Worker setting, so they work only once a production deploy has carried
`previewUrls: true`. In Workers Builds, set the non-production branch deploy command to
`npx wrangler versions upload --experimental-new-config` to get the same for every pushed branch.

## Where things are

- `src/lib/site.ts`: every link, the principles, the feature groups, the FAQ and the copy of the
  pages below the home page. Most copy changes happen here.
- `src/routes/+page.svelte`: the home page and its sections. `src/routes/reports/`,
  `src/routes/maps/`, `src/routes/roles/` and `src/routes/sub-trees/` are the pages below it;
  `+layout.svelte` holds the nav they share. Add a new page to `static/sitemap.xml`, to the nav in
  `SiteNav.svelte` and to the footer links in `SiteFooter.svelte`.
- `src/lib/components/`: the hero, the family explorer, the section connectors and the copyable
  command blocks. `MarshDrawing.svelte` draws the sample family's view for the sub-trees figure and
  the reports page's poster; `LifeMapFigure.svelte` is the maps page's drawn life map, which loads
  no map tiles. `EpochMark.svelte` is copied from the app; change the two together.
- `src/lib/family.ts` and `src/lib/morph.ts`: the explorer's invented family, where each view
  puts its people, and the bent-card geometry that morphs one view into the next. The layouts
  copy the app's `chart-layout.ts`, `fan-layout.ts`, `PersonCard` and `TreeEdge`; check them
  against the demo when a view changes in the app.
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
