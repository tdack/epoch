// jsdom does no layout, so it ships neither of these. Components that react to their size or scroll
// themselves into view (PageTabs) get inert versions; tests that care stub their own.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
