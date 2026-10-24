/** Static files from `files` worth precaching: icons, manifest and the offline page. The splash
 * and og images are large and only used signed out, so they stay on the network. */
export function isShellFile(pathname: string): boolean {
	return (
		/^\/brand\/(icon|apple-touch-icon)[^/]*$/.test(pathname) ||
		pathname === '/brand/manifest.webmanifest' ||
		pathname === '/offline.html' ||
		pathname === '/offline.css' ||
		pathname.startsWith('/favicon.')
	);
}

/** Only same-origin GETs are ever answered by the worker; everything else is left to the browser. */
export function isHandledRequest(
	method: string,
	requestOrigin: string,
	ownOrigin: string
): boolean {
	return method === 'GET' && requestOrigin === ownOrigin;
}
