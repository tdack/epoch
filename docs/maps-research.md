# Maps and geocoding: OpenStreetMap and Leaflet research

- **Date:** 2026-10-26
- **Scope:** Research only. No code, ADR or backlog change. It answers webtrees-comparison.md 1.9
  ("Places have no hierarchy or map") and the backlog's "Places and maps" section.
- **Question:** Can Epoch map places with OpenStreetMap (OSM) services and Leaflet, inside their free
  terms? How does that compare with Google Maps Platform?

**Short answer.** Yes, for a private tree with a few users. Use these:

- Leaflet with OSM raster tiles for display.
- Photon for search as you type.
- Nominatim for explicit lookups and for a slow, one-off matching job.

Store the coordinates on Epoch's own `places` records. Every OSM call goes through a Worker proxy
that caches the results. Google's terms rule it out for this design, whatever the price. Its
geocoding and Places results may be shown only on a Google map, and may not be stored. Only the
`place_id` may be kept.

> **Read the usage policies before building anything.** The public OSM services are run by
> volunteers on donated hardware. They give no SLA, can block you without notice, and their rules
> may change. The Nominatim policy asks that any LLM-written material that suggests the service
> point to the policy and explain its limits. This document is such material. Read these:
>
> - [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): at most
>   1 request per second per *application* (all users together). **No autocomplete**, including
>   on the client. Results must be cached. A User-Agent or Referer must identify the app. Bulk
>   geocoding is discouraged. Periodic or long-running jobs are capped at 4 requests per minute.
>   The app must be able to switch the service off without a software update. Do not send
>   personal data.
> - [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/): visible
>   attribution, a Referer from browsers, and the cache headers respected. No prefetching, offline
>   download or bulk seeding. Access is best-effort, and they recommend making the tile URL
>   configurable.

---

## 1. What Epoch has today

| Piece | State | Where |
|---|---|---|
| Place record | `places (id, tree_id, name_key)`, derived from the fact's text. Rename and merge go through `rewrite_place`. The fact's text is the authority. | ADR-018, ADR-019 |
| Coordinates | `events.latitude` and `events.longitude` per fact, from an imported `PLAC.MAP`, stored as written (`N18.150944`) | ADR-051 |
| Place input | `PlaceInput.svelte` suggests places already in the tree | `src/lib/components/forms/PlaceInput.svelte` |
| Privacy | The place list and page count only visible people (`andVisible`). A place that only private people use answers as if nobody wrote it. | ADR-018 |
| Headers | `Referrer-Policy: strict-origin-when-cross-origin`, and no CSP | `src/lib/server/http/security-headers.ts` |
| Backlog constraints | Event maps come after place quality. Geocoding must never send private-person details or overwrite historical labels. Fact coordinates should feed a place-level coordinate. | `docs/backlog.md`, "Places and maps" |

What the headers mean for maps:

- The referrer policy already meets OSM's Referer rule. Tile hosts receive the page's **origin**,
  which includes the tree's subdomain (ADR-041 subdomains). They never receive the path, so no
  person id leaks. Self-hosted tiles (section 3.3) remove even that.
- No CSP exists, so adding tile hosts needs no header change. If a CSP is added later, it must allow
  the tile and geocoder hosts.

---

## 2. Recommended architecture

```
Browser (Leaflet)                    Worker                              Outside
─────────────────                    ──────                              ───────
tiles  ───────────────────────────────────────────────────────────────▶ tile host (configurable)
PlaceInput ── /api/geo/search?q= ──▶ cache (D1 or KV) ── miss ─────────▶ Photon
"Find on map" ── /api/geo/lookup ──▶ cache ── miss ── serialised ──────▶ Nominatim
Match places (manager) ── job ─────▶ Queue/Workflow, 1 at a time ──────▶ Nominatim (≤1 rps, one-off)
Map pages ── /api/trees/:id/map ───▶ places + visible events only (no outside call)
```

Principles:

1. **Only place text leaves Epoch.** It is never sent with a person, date or tree id. The proxy
   sends a fixed `User-Agent` such as `Epoch/<version> (+contact)`, which the policy requires.
2. **Cache everything permanently.** The cache key is the normalised query text. Nominatim
   requires a cache, and the same query asked twice can get a client blocked.
3. **A kill switch.** A per-provider "enabled" setting in tree or site settings (ADR-075) turns
   off Photon and Nominatim calls without a deploy. The tile URL is a setting too.
4. **Geocoding is user-initiated.** Geocoding on every save would count as periodic use. A user
   picks a suggestion or presses "Find on map", or a manager runs the matching job.
5. **One serialised consumer for Nominatim.** A Worker runs in many places at once, so "1 request
   per second, single thread, one machine" needs one consumer. That can be a Queue with
   `max_concurrency: 1` and a one-second pause, a Workflow step loop with `step.sleep`, or one
   Durable Object. Cloudflare's rate-limiting binding may count per location rather than globally,
   so don't rely on it. That is not verified.

### 2.1 Data model sketch (place level, expand-only)

New nullable columns on `places`, or a `place_geo` table keyed by place id. Each lands in its own
migration before any code reads it.

| Column | Meaning |
|---|---|
| `latitude`, `longitude` | Decimal degrees (REAL). They come from the file (ADR-051) or a confirmed geocode. |
| `geo_status` | `suggested` \| `confirmed` \| `ignored` \| `unmatched` |
| `geo_source` | `gedcom` \| `nominatim` \| `photon` \| `manual` (dragged pin) \| `wikidata`, and so on |
| `osm_type`, `osm_id` | Stable OSM reference, for a later refresh and a "view on OSM" link |
| `geo_display_name` | The provider's name, such as "Ballarat, Victoria, Australia". It is shown, never written to facts. |
| `geo_confidence` | The provider's importance, or a match score |
| `geo_hierarchy` | Country, state, county and town from `addressdetails`, the seed for hierarchical places |
| `geo_matched_at`, `geo_matched_by` | Provenance |

Rules that follow ADR-018 and ADR-019:

- **Fact text is never changed by geocoding.** "Accept" stores coordinates on the place record.
  "Replace" is a separate, explicit choice that runs the existing `rewrite_place` command with the
  OSM name. That gives one change, one preview, one undo, and the 200-fact cap. Historical text
  such as "Königsberg, Preußen" should normally be accepted, not replaced.
- **"Ignore"** sets `ignored`, so the job and the quality rule stop proposing it.
- **File coordinates win.** If a fact at the place has `LATI` and `LONG`, they seed the place as
  `confirmed` with source `gedcom`. Facts that disagree become a quality finding (section 5).
- **An empty place record keeps its coordinates.** An undo that restores the old text finds the
  same record (ADR-019), so its geocode comes back too.
- **Export is unchanged by default.** Writing place-level coordinates into every `PLAC.MAP` would
  change export bytes and raises the ODbL question in section 6. Make it a later export option.

---

## 3. OSM component by component

### 3.1 Search as you type (feature 1)

Nominatim **forbids** autocomplete, so the design has three layers:

1. **The tree's own places first.** `PlaceInput.svelte` already does this. It needs no network
   call and gives the best match for a family tree, where the same 50 parishes repeat.
2. **Photon suggestions after that.** [Photon](https://github.com/komoot/photon) is built for
   search as you type. It is based on OSM, tolerates typos, supports several languages, and can
   filter by bounding box or OSM tag. You can bias it to places with `osm_tag=place` and the
   layers for city, county, state and country. Query it through `/api/geo/search` with
   these limits:
   - debounce of about 300 ms
   - at least 3 characters
   - a cancelled request when the user types on
   - results cached in the Worker

   The public instance at `photon.komoot.io` allows only "reasonable" use. Heavy use is throttled
   or banned, and it has no guarantee. That fits a family of editors, not a public product.
3. **Nominatim on an explicit action**, such as a "Find on map" button beside the field. Use it
   for structured results and `addressdetails`.

Picking a suggestion fills the text, as today. It also attaches the coordinates to the place
record as `confirmed`. The user can keep their own spelling, such as "St Mary's, Ballarat", and
still get the pin.

**Escape hatch.** Self-host Photon or Nominatim. The Photon README gives about 95 GB of SSD and
64 GB of RAM for the whole planet, which does not fit Workers. A country extract on a small VPS
is possible but is operations work Epoch doesn't do today. [GeoNames](https://www.geonames.org/)
is a lighter fallback: free with a registered username, with hourly and daily credit limits
(check the current numbers). [Wikidata](https://www.wikidata.org/) is CC0 and has historical
entities and dates.

### 3.2 Matching existing places (feature 2)

A manager runs a **"Match places"** job:

1. Pick the unmatched place records with at least one visible fact. Skip `ignored`, `confirmed`
   and `gedcom` places.
2. **Privacy filter** (section 4). Skip any place used only by private or living people, and
   anything that looks like a street address. Only localities go out.
3. Query Nominatim one at a time through the serialised consumer, with `limit=5` and
   `addressdetails=1`. Store every candidate in the cache.
4. Score each candidate. Use Nominatim's `importance` and how many comma-separated parts of the
   text match the returned hierarchy. Boost places near the tree's other confirmed places, so
   "Richmond" in a Victorian tree resolves to Victoria, not to Virginia or Surrey.
5. Show a review screen like the quality report: place text, fact count, best candidate on a
   small map, other candidates, and **Accept**, **Accept and rename (replace)**, **Ignore**,
   **Pick on map** and **Search again**. Add bulk "accept all above score X".

Throughput: a tree with 1,500 distinct places takes about 25 minutes at 1 request per second.
That fits the "small one-time task" the policy tolerates. Re-runs over only new places should
stay well below the 4-per-minute periodic cap, or move to Photon. Historical names that OSM
lacks, such as "Prussia" or "Van Diemen's Land", will fail. The **Pick on map** fallback, and
later Wikidata or OpenHistoricalMap, cover them.

### 3.3 Map display

| Option | Cost | Notes |
|---|---|---|
| **OSM standard raster** (`tile.openstreetmap.org`) with **Leaflet** | Free | Simplest. The policy suits light use and forbids prefetch and offline. Attribution "© OpenStreetMap contributors" is mandatory. |
| [**OpenFreeMap**](https://openfreemap.org) vector tiles | Free, no key, donation-funded | Commercial use allowed. Vector, so it needs MapLibre GL, or Leaflet with the `maplibre-gl-leaflet` bridge (not verified). |
| [**Protomaps**](https://docs.protomaps.com/deploy/cloudflare) PMTiles on **R2** behind a Worker | Storage plus Worker requests | Fits Epoch's stack. No third party sees requests, so no origin leaks. A planet file is about 110 GB, and a regional extract is much smaller. Vector, so MapLibre or a bridge. |
| Commercial OSM hosts (MapTiler, Stadia, Thunderforest) | Free tiers with keys | Check each one's current limits. Mostly needed only for special styles. |

**Recommendation:** make the tile URL a setting. Default to OSM raster for a private tree. Point a
public tree (ADR-041), or anyone deploying the open-source Epoch at scale, to Protomaps on R2 or
OpenFreeMap.

**Leaflet or MapLibre GL.** Leaflet is small (about 40 KB gzipped) and simple. It has
the plugins this design needs:

- `Leaflet.markercluster` for clusters
- `leaflet.heat` for heat maps
- `Leaflet.PolylineDecorator` for arrows
- polylines out of the box

**Use Leaflet 2.0** (the owner's choice, 2026-10-26). It suits Epoch's stack: ES modules with
named imports and no global `L`, Pointer Events, and no IE polyfills. The risks to accept:

- npm still shows `2.0.0-alpha.1` (16 August 2025) as the newest 2.x, and `latest` is 1.9.4. The
  alpha has had no release in over a year. Pin the exact version.
- 1.x plugins expect the global `L` and its factory functions. Each plugin above needs checking,
  then either the `leaflet-global.js` bundle as a stopgap, a fork, or a small Svelte-owned
  replacement. A replacement is probably simplest for polylines with arrows and a basic heat
  layer. Clustering is the plugin worth keeping.
- Wrap Leaflet in one Svelte component that owns its lifecycle (create in `onMount`, `remove()` on
  destroy). Then a later move to 1.9 or 2.x stable touches one file.

MapLibre GL is heavier but needed for vector tiles, a globe projection, and the OpenHistoricalMap
time filter (section 5). Either way, load the map library lazily, only on routes that show a map.

### 3.5 CORS and CSP

**CORS mostly doesn't apply to raster tiles.** Leaflet loads raster tiles as `<img>` elements, and
an image needs no CORS to display. CORS matters only in these cases:

- **Reading pixels**, for example exporting the map to a PNG or printing it through a canvas. A
  tile loaded without `crossOrigin` taints the canvas. Set Leaflet's `crossOrigin: true` tile
  option. The OSM tile server sends `Access-Control-Allow-Origin: *` (checked 2026-10-26), so that
  works.
- **Vector tiles and style JSON** (OpenFreeMap, Protomaps, OpenHistoricalMap). MapLibre fetches
  these with `fetch`, so the host must send CORS headers. OpenFreeMap does. With Protomaps on R2,
  Epoch's own Worker serves them, so it's same-origin, or Epoch sets the header itself.
- **Geocoders.** In this design the browser calls only Epoch's `/api/geo/*` proxy, which is
  same-origin, so Photon's and Nominatim's CORS headers don't matter. The proxy is also where the
  required `User-Agent` and caching happen. A browser can't set `User-Agent` on `fetch`, so the
  proxy is needed anyway.

**CSP: Epoch sends none today, so nothing blocks tiles.** If a CSP is added later, the map needs
these directives:

| Directive | Value | Why |
|---|---|---|
| `img-src` | `'self' https://tile.openstreetmap.org data: blob:` | Raster tiles. Leaflet also uses `data:` images for some icons. Use the configured tile host, not a hard-coded one. |
| `connect-src` | `'self'`, plus the vector tile host if it isn't Epoch | MapLibre's `fetch` of tiles and styles. Geocoders go through the proxy, so they need no entry. |
| `worker-src` | `blob:` | MapLibre only: it starts its workers from a blob URL. |
| `style-src` | the stylesheet's origin | Leaflet's CSS file. Leaflet positions tiles and markers through `element.style`, which a CSP does not block. Only inline `<style>` blocks and `style=""` attributes in HTML would need `'unsafe-inline'`. |

**Referrer.** `Referrer-Policy: strict-origin-when-cross-origin` already meets OSM's rule that
browsers send a Referer. Don't tighten it to `no-referrer` on map pages, or OSM may block the
tiles.

### 3.4 People grouped by location (feature 3)

There are three map surfaces. All of them are read-only and use the visibility predicates (section 4).

- **Place page (`/place?name=`).** One pin, a "nearby places" list (by distance from the
  stored coordinates), and the facts already listed.
- **Person page "Places" tab.** The person's dated facts, numbered in date order and joined by a
  line, so the page shows a life's route. Each marker is coloured by type: birth, christening,
  marriage, residence, census, death or burial. Undated facts are listed apart and not joined.
- **Tree map (`/map`).** One marker per place, clustered, with a count badge. Filter chips by
  event type (birth, marriage, death, burial, residence, census, other), surname, sub-tree
  (ADR-062) and year range. The popup groups people by event type with links. A list beside the
  map follows the viewport ("people in view").

Data path: one endpoint returns `place id → lat/lng + [{personId, name, eventType, dateSort}]`
for visible facts only. It reuses the place-list query's `andVisible` plus the
all-partners-visible test for partnership events. Cluster counts are computed from that filtered
set, so a cluster never counts a hidden person.

---

## 4. Privacy

| Risk | Mitigation |
|---|---|
| Place text sent to Photon or Nominatim reveals a living person's address | Geocode only places with at least one fact by a person the "likely living" rule treats as dead, or by a public person. Never geocode text that looks like a street address (it has a house number or an `ADDR`). Strip to locality. Nominatim's policy itself says not to send personal data. |
| Query timing or grouping reveals a family | Send queries alone, without tree or person context, from the shared Worker User-Agent. Cache hits make no outside call. |
| Markers or clusters show hidden people | Build them from the same `andVisible` predicate as the place list (ADR-018). Add a plan test like the place-list one, so viewer and contributor answers stay identical. |
| Living people's homes on a public map | Leave living people's `RESI` and census facts off the map by default. A setting could coarsen them to town level. |
| Tile host sees the tree's subdomain | Self-host tiles (Protomaps on R2), or accept it for private trees. |

---

## 5. Other ways to use the geography

Ordered from cheapest to most ambitious. Each one needs only confirmed place coordinates plus the
existing `date_value` bounds.

1. **Pedigree map**, as in webtrees' `PedigreeMapModule`. Lines from a person to each ancestor's
   birthplace, coloured by generation and reusing the fan chart's generation colours. It shows
   where the "eight great-grandparents" came from.
2. **Migration flows.** Draw an arrow from each parent's birthplace to the child's birthplace,
   and from birth to death. Aggregate same-route arrows with a width per count. Filter by surname
   or branch to see "the Irish line went Cork → Liverpool → Ballarat".
3. **Time slider.** Show facts whose date bounds overlap a chosen year, and animate across
   decades. Imprecise dates (ADR-004) fade in over their lower-to-upper range instead of popping
   in at a made-up day. Show "alive in year X" people at their last known place before X.
   Leaflet.TimeDimension (last updated 2022) or a plain range input can drive it.
4. **Family centre of gravity.** For each decade, the mean location of the living family members,
   drawn as a trail. One line tells a family's drift across a century.
5. **Surname density.** A heat map or graduated circles per surname per period. It works with
   cluster data that is already filtered.
6. **Distance facts.**
   - "Born 12 km from where she died"
   - "Married 40 km from home" (the marriage radius)
   - "Furthest-travelled ancestor"

   These are small cards on the person page and in a later statistics page (webtrees-comparison
   1.6).
7. **Descendant spread.** Descendants of a chosen person, coloured by generation, to show a
   diaspora. It reuses sub-tree membership (`inSubtree`).
8. **Historical context.** Show the boundaries of the event's year from
   [OpenHistoricalMap](https://www.openhistoricalmap.org), with vector tiles filtered by
   `start_decdate`/`end_decdate`, which needs MapLibre. Then "Silesia 1850" lies inside Prussia,
   not Poland. Historic scanned map layers such as the National Library of Scotland's are another
   option, under their own terms.
9. **3D globe.** Arcs of migration on a globe, a geographic partner to Epoch's 3D views (Orrery,
   Rings). MapLibre has a globe projection. Three.js already exists in the 3D scenes.
10. **Visit planning.** Burials and churches near a chosen point, and "open directions" as a plain
    link to OSM or Google Maps. A link needs no API key and no Directions API.
11. **Map-based quality rules** for the quality report:
    - place unmatched
    - fact `LATI`/`LONG` far from the place's coordinates
    - impossible travel (child born 3,000 km from the mother's residence in the same year)
    - two place records within a few hundred metres that are probably the same place (a merge
      candidate for `rewrite_place`)
12. **Hierarchy from geocoding.** `addressdetails` gives country, state, county and town. It
    seeds the backlog's hierarchical places (country → state → town drill-down, webtrees'
    `PlaceHierarchyListModule`) without parsing comma-separated text.

---

## 6. OSM compared with Google Maps Platform

| | OSM stack | Google Maps Platform |
|---|---|---|
| **Display** | Leaflet or MapLibre, any tile host | Maps JavaScript API |
| **Autocomplete** | Photon (fair use). Nominatim forbids it. | Places Autocomplete, which is mature and strong on modern addresses |
| **Geocoding** | Nominatim at 1 request per second, cached | Geocoding API, fast, with a high quota |
| **Storing results** | Allowed, with ODbL attribution | Only `place_id` may be stored indefinitely. Other Places content may not be cached beyond narrow exceptions. Archived service terms (2025) allowed geocoding lat/lng for 30 days. |
| **Showing results on another map** | Allowed | **Not allowed.** Places and Geocoding results "must be shown on a Google Map". Without a map, the Google logo is required. |
| **Historical places** | Weak (current names only). OpenHistoricalMap and Wikidata help. | Weak (current names only) |
| **Directions** | OSRM, GraphHopper or openrouteservice (self-host or keyed free tiers), or a link | Directions API, but a link does the job |
| **Cost** | Free. Donations encouraged. | Since 1 March 2025, a free allowance per SKU each month: 10,000 for most Essentials SKUs, 5,000 for Pro, 1,000 for Enterprise. It needs a billing account. I did not confirm which tier Autocomplete and Dynamic Maps fall in. |
| **Reliability** | Best effort, can block without notice | SLA on paid plans |
| **Privacy** | Requests reach volunteer servers (or none, if self-hosted) | Requests reach Google, under the key owner's account |

**Verdict.** Epoch stores coordinates on place records and reuses them across maps, timelines and
quality rules. Google forbids that pattern. Using Google would mean calling Google again each time
for anything beyond a `place_id`, and only on a Google map. Google's free allowance would cover a
family tree, so cost is not the deciding factor. Keep to OSM. A Google key adds little that the
"Pick on map" fallback does not already give. If one is ever used, use it only for autocomplete
inside a Google-map picker, and store only `place_id` plus coordinates entered by the user.

**Google tiles as a setting: decided against (2026-10-26).** Leaflet can show Google tiles in two
legal ways. One is the Map Tiles API (2D tiles, with session tokens, attribution, and 100,000
free requests a month). The other is the `GoogleMutant` plugin, which embeds the Maps JavaScript
API. Pointing Leaflet straight at Google's tile URLs breaks Google's terms. A key setting would
bring its own session-token handling, attribution rules and an extra option. OSM tiles do
everything this design needs, so the owner chose not to build it. The tile URL setting (section
3.3) stays for other OSM-based hosts.

**ODbL (to verify, not decided here).** Coordinates from Nominatim are OSM data. Storing them
beside Epoch's own data, and exporting them as GEDCOM `LATI`/`LONG`, raises the share-alike
question. OSMF publishes a
[geocoding guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline)
for this case. At minimum, credit "© OpenStreetMap contributors" wherever geocoded coordinates are
shown or exported.

---

## 7. Suggested order

1. Place-level coordinates: columns, seeding from GEDCOM `MAP`, and showing a pin on the place
   page. No outside calls yet.
2. Geocoding proxy (Photon search, Nominatim lookup), cache, kill switch and settings.
   `PlaceInput` suggestions and "Find on map".
3. The "Match places" job and its review screen, with the privacy filter.
4. Tree map with clusters and filters, and the person page Places tab.
5. Pedigree map, migration flows and time slider.
6. Hierarchy from `addressdetails`, map quality rules, and the ODbL decision for export.

---

## 8. Not verified

- Whether Cloudflare's rate-limiting binding counts globally. Assume not, and serialise.
- Photon's current public limits beyond "reasonable use", and GeoNames' current credit limits.
- Whether markercluster and the other plugins work with Leaflet 2.0, and whether a 2.0 stable
  release is coming.
- The current state of `maplibre-gl-leaflet` and of the OpenHistoricalMap Leaflet time slider,
  which was a 2019 prototype.
- Which Google pricing tier Places Autocomplete and Dynamic Maps are in, and the current
  lat/lng caching rule outside the archived 2025 terms.
- Whether the ODbL geocoding guideline treats stored and exported coordinates as a derivative
  database.

## Sources

- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [Photon README](https://github.com/komoot/photon)
- [OpenFreeMap](https://openfreemap.org)
- [Protomaps on Cloudflare](https://docs.protomaps.com/deploy/cloudflare)
- [Leaflet 2.0 alpha announcement](https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html)
- [OpenHistoricalMap](https://en.wikipedia.org/wiki/OpenHistoricalMap)
- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Geocoding API policies](https://developers.google.com/maps/documentation/geocoding/policies)
- [Google Maps service terms, archived 2025-05-01](https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501)
- [Google Maps Platform March 2025 pricing changes](https://developers.google.com/maps/billing-and-pricing/march-2025)
