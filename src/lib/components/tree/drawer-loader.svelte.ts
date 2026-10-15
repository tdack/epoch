import type { PersonPageDto } from '#lib/shared/person-page.js';
import { fetchPersonPage } from '#lib/services/tree-api.js';

interface DrawerLoaderOptions {
	/** A getter because the page can move to another tree without being recreated. */
	treeId: () => string;
	/** Called when the person cannot be loaded, before `error` is set. */
	onMissing: () => void;
	/** Injected so the tests need no network. */
	fetchPage?: (treeId: string, personId: string) => Promise<PersonPageDto>;
}

/** The person page the details drawer shows, kept current as the selection and the tree change. */
export function createDrawerLoader({
	treeId,
	onMissing,
	fetchPage = fetchPersonPage
}: DrawerLoaderOptions) {
	let page = $state<PersonPageDto | null>(null);
	let error = $state<string | null>(null);
	// A slow earlier response must not overwrite a later one, so only the newest request may land.
	let latestRequest = 0;
	return {
		get page() {
			return page;
		},
		get error() {
			return error;
		},
		/** `null` closes the drawer. Loading again for the same person refreshes it. */
		load(id: string | null) {
			if (!id) {
				page = null;
				error = null;
				return;
			}
			const request = ++latestRequest;
			fetchPage(treeId(), id)
				.then((loaded) => {
					if (request !== latestRequest) return;
					page = loaded;
					error = null;
				})
				.catch((cause: Error) => {
					if (request !== latestRequest) return;
					// The person is gone (deleted, undone away, or a stale link): there is nothing to keep
					// open. Replacing the entry keeps Back from returning to a drawer that cannot open.
					onMissing();
					error = cause.message;
				});
		}
	};
}
