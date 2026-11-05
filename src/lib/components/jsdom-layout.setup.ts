// jsdom does no layout, so it ships none of these. Components that react to their size, scroll
// themselves into view (PageTabs) or follow a media query (PersonView) get inert versions; tests
// that care stub their own.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
// Matches nothing, so a width query reads as a phone.
globalThis.matchMedia ??= (media: string) =>
	({
		matches: false,
		media,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false
	}) as MediaQueryList;
