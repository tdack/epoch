<!-- The demo's Places tab map, captured at 2x from https://demo.epochgenealogy.app (the public
"The Windsors" tree) at 1280 wide. The credit line is the map's own, kept in the picture as
OpenStreetMap asks. Recapture it when the map's look or the demo's places change. -->
<figure class="places">
	<img
		src="/maps/places.webp"
		srcset="/maps/places-600.webp 600w, /maps/places.webp 1200w"
		sizes="(max-width: 860px) 100vw, 480px"
		width="1200"
		height="1024"
		alt="A map of Europe from the demo tree's Places tab. Numbered emerald clusters gather the family's places in England and Germany, with single pins as far as Norway, Saint Petersburg, Italy and Greece."
	/>
	<figcaption>
		The demo’s Places tab: every located place of the Windsor tree on OpenStreetMap, gathered into
		numbered clusters where they sit close together. Zoom in and they come apart into pins. Map ©
		OpenStreetMap contributors.
	</figcaption>
</figure>

<style>
	.places {
		max-width: 480px;
		width: 100%;
		justify-self: center;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--stone-rule);
		border-radius: 16px;
		background: var(--tree-paper);
	}

	figcaption {
		font-size: var(--site-small);
		line-height: 1.55;
		color: var(--stone-text);
		max-width: 62ch;
	}
</style>
