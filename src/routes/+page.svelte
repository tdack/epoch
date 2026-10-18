<script lang="ts">
	import CommandBlock from '#lib/components/CommandBlock.svelte';
	import Descent from '#lib/components/Descent.svelte';
	import EpochMark from '#lib/components/EpochMark.svelte';
	import FamilyExplorer from '#lib/components/FamilyExplorer.svelte';
	import Hero from '#lib/components/Hero.svelte';
	import ViewsShowcase from '#lib/components/ViewsShowcase.svelte';
	import RichText from '#lib/components/RichText.svelte';
	import SiteNav from '#lib/components/SiteNav.svelte';
	import {
		DEMO_URL,
		FAQS,
		FEATURE_GROUPS,
		PRINCIPLES,
		REPO_CLONE_URL,
		REPO_URL,
		SITE_URL,
		TAGLINE
	} from '#lib/site.js';

	const LOCAL_COMMANDS = [
		`git clone ${REPO_CLONE_URL}`,
		'cd epoch',
		'nvm use 24',
		'npm install',
		'cp .dev.vars.example .dev.vars',
		'npm run db:migrate:local',
		'npm run dev'
	];

	const CARE = [
		{
			command: './setup doctor',
			does: 'Reports anything that has drifted from what setup created'
		},
		{
			command: './setup allow <email>',
			does: 'Lets someone through the sign-in page setup created'
		},
		{
			command: 'npm run deploy',
			does: 'Builds, applies any new migrations and deploys a new version'
		},
		{ command: './setup teardown', does: 'Deletes only what this install created' }
	];

	const DESCRIPTION =
		'Epoch is a private family-tree application that each family runs on its own Cloudflare account, shared by invitation with the relatives and researchers who help keep it.';
</script>

<svelte:head>
	<title>Epoch · {TAGLINE}</title>
	<meta name="description" content={DESCRIPTION} />
	<link rel="canonical" href="{SITE_URL}/" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="Epoch" />
	<meta property="og:description" content={TAGLINE} />
	<meta property="og:url" content="{SITE_URL}/" />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="preload" as="image" href="/brand/splash-library.webp" type="image/webp" />
</svelte:head>

<SiteNav />
<Hero />

<main>
	<section class="why" aria-labelledby="why-title">
		<div class="wrap">
			<Descent origin="ancestors" />
			<div class="split">
				<h2 id="why-title" class="display">The history stays with the family that keeps it.</h2>
				<dl class="ledger">
					{#each PRINCIPLES as principle (principle.term)}
						<div>
							<dt>{principle.term}</dt>
							<dd>{principle.text}</dd>
						</div>
					{/each}
				</dl>
			</div>
		</div>
	</section>

	<FamilyExplorer />

	<section id="features" class="features" aria-labelledby="features-title">
		<div class="wrap">
			<Descent origin="union" />
			<header class="centred">
				<h2 id="features-title" class="display">Families as they were, not as a form expects.</h2>
				<p class="lede">
					More than one family per child, partnerships that end and begin again, and dates kept
					exactly as the record gives them.
				</p>
			</header>

			<div class="groups">
				{#each FEATURE_GROUPS as group (group.title)}
					<article class="group">
						<h3>{group.title}</h3>
						<p>{group.text}</p>
						<ul>
							{#each group.points as point (point)}
								<li>{point}</li>
							{/each}
						</ul>
					</article>
				{/each}
				<aside class="try">
					<p>See it with a real tree before you install anything.</p>
					<a class="button vellum" href={DEMO_URL}>Explore the demo tree</a>
				</aside>
			</div>
		</div>
	</section>

	<ViewsShowcase />

	<section id="code" class="code" aria-labelledby="code-title">
		<div class="wrap">
			<Descent tone="mist" />
			<div class="split">
				<div class="stack">
					<h2 id="code-title" class="display">Get the code</h2>
					<p class="lede">
						Epoch is one SvelteKit application, in a single repository on GitHub. Clone it, run it
						on your own machine with a sample tree, then decide whether to install it.
					</p>
					<a class="button vellum" href={REPO_URL}>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path
								d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
							/></svg
						>
						tdack/epoch on GitHub
					</a>
				</div>
				<div class="stack">
					<h3 class="label">Run it locally, with Node 24</h3>
					<CommandBlock
						lines={LOCAL_COMMANDS}
						tone="dark"
						label="the commands to run Epoch locally"
					/>
					<p class="note">
						The app opens at <code>localhost:5173</code>, signed in as a local developer. With it
						running, <code>npm run seed</code> loads a fictional sample tree.
					</p>
				</div>
			</div>
		</div>
	</section>

	<section id="install" class="install" aria-labelledby="install-title">
		<div class="wrap">
			<Descent />
			<header class="centred">
				<h2 id="install-title" class="display">Install it on your own Cloudflare account</h2>
				<p class="lede">
					One command creates everything Epoch needs, deploys it and checks the result. It signs in
					through your browser, so there is no API token to make.
				</p>
			</header>

			<ol class="steps">
				<li>
					<span class="step" aria-hidden="true">1</span>
					<div>
						<h3>Have what it needs</h3>
						<p>
							Node 24, a Cloudflare account on a paid Workers plan, a Zero Trust organisation with
							an identity provider, and a workers.dev subdomain or a domain on Cloudflare.
						</p>
					</div>
				</li>
				<li>
					<span class="step" aria-hidden="true">2</span>
					<div>
						<h3>See the plan</h3>
						<p>Read-only: it shows what would be created or changed, and touches nothing.</p>
						<CommandBlock lines={['./setup --plan']} label="the setup plan command" />
					</div>
				</li>
				<li>
					<span class="step" aria-hidden="true">3</span>
					<div>
						<h3>Run setup</h3>
						<p>
							Creates the database, storage bucket, queue, Worker, address and sign-in page,
							deploys, checks the result and records you as the install owner. It asks only what it
							cannot find out itself.
						</p>
						<CommandBlock lines={['./setup']} label="the setup command" />
					</div>
				</li>
				<li>
					<span class="step focus" aria-hidden="true">4</span>
					<div>
						<h3>Invite your family</h3>
						<p>
							Import a GEDCOM file or start a tree, then invite relatives from the tree's Members
							page, each with their own role.
						</p>
					</div>
				</li>
			</ol>

			<div class="care">
				<h3 class="label">Looking after an install</h3>
				<table>
					<tbody>
						{#each CARE as row (row.command)}
							<tr>
								<th scope="row"><code>{row.command}</code></th>
								<td>{row.does}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="note">
					Setup never creates your account, plan, Zero Trust organisation or domain, and never edits
					an Access policy it did not create. Every flag is in <code>./setup --help</code> and the
					<a href="{REPO_URL}#readme">README</a>.
				</p>
			</div>
		</div>
	</section>

	<section id="faq" class="faq" aria-labelledby="faq-title">
		<div class="wrap narrow">
			<Descent />
			<h2 id="faq-title" class="display centred-text">Questions</h2>
			<div class="questions">
				{#each FAQS as faq, i (faq.question)}
					<details open={i === 0}>
						<summary>
							<span>{faq.question}</span>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
							>
						</summary>
						{#each faq.answer as paragraph, j (j)}
							<p><RichText text={paragraph} /></p>
						{/each}
					</details>
				{/each}
			</div>
		</div>
	</section>
</main>

<footer class="close">
	<div class="wrap">
		<Descent tone="vellum" isFocus />
		<p class="close-title">Start with someone else's tree.</p>
		<a class="button amber" href={DEMO_URL}>Explore the demo tree</a>
		<div class="colophon">
			<a href="#top" class="mark-link">
				<EpochMark size={28} ink="var(--vellum)" />
				<span>Epoch</span>
			</a>
			<p>Inspired by the capabilities of webtrees, not its screens or code.</p>
			<ul>
				<li><a href={REPO_URL}>GitHub</a></li>
				<li><a href={DEMO_URL}>Demo</a></li>
				<li><a href="#install">Install</a></li>
			</ul>
		</div>
	</div>
</footer>

<style>
	.wrap {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) var(--section-gap);
	}

	.wrap.narrow {
		max-width: 880px;
	}

	.display {
		margin: 0;
		font-size: clamp(2rem, 4.2vw, 2.875rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.lede {
		margin: 0;
		font-size: clamp(1.0625rem, 1.5vw, 1.1875rem);
		line-height: 1.6;
		color: var(--stone-text);
	}

	.label {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.note {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.6;
	}

	.centred {
		max-width: 760px;
		margin: 0 auto clamp(40px, 5vw, 56px);
		display: flex;
		flex-direction: column;
		gap: 16px;
		text-align: center;
	}

	.centred-text {
		text-align: center;
		margin-bottom: clamp(32px, 4vw, 44px);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: clamp(32px, 6vw, 72px);
		align-items: start;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
		align-items: flex-start;
	}

	.stack > :global(.block) {
		align-self: stretch;
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 0 22px;
		border-radius: 12px;
		font-weight: 700;
		font-size: 1rem;
		text-decoration: none;
		transition: background-color 160ms var(--ease-out);
	}

	.button.vellum {
		background: var(--vellum);
		color: var(--emerald-900);
	}

	.button.vellum:hover {
		background: var(--field-white);
		color: var(--emerald-900);
	}

	.button.amber {
		min-height: 56px;
		padding: 0 28px;
		border-radius: 9999px;
		background: var(--amber);
		color: var(--emerald-950);
		font-size: 1.125rem;
		box-shadow: 0 10px 30px rgb(2 44 34 / 0.4);
	}

	.button.amber:hover {
		background: var(--amber-300);
		color: var(--emerald-950);
	}

	/* Why: a ledger of terms beside the claim. */
	.ledger {
		margin: 0;
		border-top: 1px solid var(--stone-edge);
	}

	.ledger div {
		display: grid;
		grid-template-columns: 9.5rem minmax(0, 1fr);
		gap: 8px 24px;
		padding: 20px 0;
		border-bottom: 1px solid var(--stone-rule);
	}

	.ledger dt {
		padding-top: 3px;
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--emerald-800);
	}

	.ledger dd {
		margin: 0;
		color: var(--stone-strong);
		max-width: 60ch;
	}

	/* Features */
	.features {
		background: var(--stone-shelf);
		border-block: 1px solid var(--stone-rule);
	}

	.groups {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(36px, 4vw, 48px) clamp(32px, 5vw, 64px);
	}

	.group h3 {
		margin: 0 0 8px;
		font-size: 1.3125rem;
		line-height: 1.3;
	}

	.group p {
		margin: 0 0 14px;
		color: var(--stone-strong);
	}

	.group ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--stone-rule);
	}

	.group li {
		position: relative;
		padding: 9px 0 9px 22px;
		border-bottom: 1px solid var(--stone-rule);
		font-size: 0.96875rem;
		line-height: 1.5;
		color: var(--stone-strong);
	}

	/* A small partner disc, the mark's own bullet. */
	.group li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.95em;
		width: 7px;
		height: 7px;
		border-radius: 9999px;
		background: var(--emerald-800);
	}

	.try {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 18px;
		padding: clamp(24px, 3vw, 36px);
		border-radius: 16px;
		background: var(--emerald-800);
		color: var(--vellum);
	}

	.try p {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1.4;
		font-weight: 600;
	}

	.try .button:focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 3px;
	}

	/* Get the code */
	.code {
		background: var(--emerald-950);
		color: var(--vellum);
	}

	.code .display {
		color: var(--vellum);
	}

	.code .lede,
	.code .note {
		color: var(--emerald-200);
	}

	.code .label {
		color: var(--emerald-mist);
	}

	.code code {
		color: #ecfdf5;
	}

	.code :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 3px;
	}

	/* Install */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(32px, 4vw, 44px) clamp(32px, 5vw, 64px);
	}

	.steps li {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		gap: 16px;
	}

	.steps h3 {
		margin: 6px 0 8px;
		font-size: 1.1875rem;
	}

	.steps p {
		margin: 0 0 12px;
		color: var(--stone-strong);
	}

	.step {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 9999px;
		border: 2px solid var(--emerald-800);
		color: var(--emerald-800);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.step.focus {
		border-color: var(--amber);
		background: var(--amber);
		color: var(--emerald-950);
	}

	.care {
		margin-top: clamp(48px, 6vw, 72px);
		padding-top: clamp(28px, 3vw, 36px);
		border-top: 1px solid var(--stone-edge);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.care .label {
		color: var(--stone-text);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		background: var(--field-white);
		border: 1px solid var(--stone-rule);
		border-radius: 12px;
		overflow: hidden;
		font-size: 0.96875rem;
	}

	th,
	td {
		padding: 12px 16px;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--stone-rule);
	}

	tr:last-child th,
	tr:last-child td {
		border-bottom: 0;
	}

	th {
		width: 16rem;
		font-weight: 400;
		white-space: nowrap;
	}

	th code {
		color: var(--emerald-900);
		font-size: 0.9375rem;
	}

	td {
		color: var(--stone-strong);
	}

	.care .note {
		color: var(--stone-text);
	}

	/* FAQ */
	.faq {
		background: var(--stone-shelf);
		border-top: 1px solid var(--stone-rule);
	}

	.questions {
		background: var(--field-white);
		border: 1px solid var(--stone-rule);
		border-radius: 12px;
	}

	details {
		border-bottom: 1px solid var(--stone-rule);
	}

	details:last-child {
		border-bottom: 0;
	}

	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 64px;
		padding: 16px clamp(16px, 3vw, 24px);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--stone-ink);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		color: var(--emerald-800);
	}

	summary:focus-visible {
		outline-offset: -2px;
	}

	summary svg {
		flex: none;
		color: var(--stone-text);
		transition: rotate 200ms var(--ease-out);
	}

	details[open] summary svg {
		rotate: 180deg;
	}

	details p {
		margin: 0;
		padding: 0 clamp(16px, 3vw, 24px) 18px;
		max-width: 68ch;
		color: var(--stone-strong);
	}

	details p + p {
		margin-top: -4px;
	}

	details :global(code) {
		font-size: 0.9375em;
		color: var(--emerald-900);
	}

	/* Close: the line arrives at the amber child, the one action. */
	.close {
		background: var(--emerald-900);
		color: var(--vellum);
	}

	.close .wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 24px;
		padding-bottom: 40px;
	}

	.close-title {
		margin: 0;
		font-size: clamp(1.75rem, 3.4vw, 2.25rem);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.015em;
	}

	.close :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 4px;
	}

	.colophon {
		width: 100%;
		margin-top: clamp(56px, 7vw, 88px);
		padding-top: 24px;
		border-top: 1px solid rgb(167 243 208 / 0.2);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 24px;
		font-size: 0.9375rem;
		color: var(--emerald-200);
	}

	.colophon p {
		margin: 0;
	}

	.colophon ul {
		display: flex;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.colophon a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 10px;
		color: var(--emerald-100);
	}

	.colophon a:hover {
		color: var(--vellum);
	}

	.colophon .mark-link {
		gap: 10px;
		padding: 0;
		font-weight: 700;
		text-decoration: none;
		color: var(--vellum);
	}

	@media (max-width: 860px) {
		.split,
		.groups,
		.steps {
			grid-template-columns: minmax(0, 1fr);
		}

		th {
			width: auto;
		}
	}

	@media (max-width: 560px) {
		.ledger div {
			grid-template-columns: minmax(0, 1fr);
		}

		table,
		tbody,
		tr,
		th,
		td {
			display: block;
		}

		th {
			padding-bottom: 2px;
			border-bottom: 0;
			white-space: normal;
		}

		.colophon {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
