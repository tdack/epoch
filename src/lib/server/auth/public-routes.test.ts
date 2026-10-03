import { describe, it, expect } from 'vitest';
import {
	isPublicPagePath,
	LOGIN_PATH,
	safeNextPath,
	shouldRedirectToWelcome,
	WELCOME_PATH
} from './public-routes';

const signedOutPage = { method: 'GET', isDataRequest: false, hasUser: false };

describe('public routes', () => {
	it('lists only the welcome and login pages as public', () => {
		expect(isPublicPagePath(WELCOME_PATH)).toBe(true);
		expect(isPublicPagePath(LOGIN_PATH)).toBe(true);
		expect(isPublicPagePath('/')).toBe(false);
		expect(isPublicPagePath('/welcome/extra')).toBe(false);
		expect(isPublicPagePath('/trees/t1')).toBe(false);
	});

	it('sends a signed-out page load to the welcome page', () => {
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: '/' })).toBe(true);
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: '/trees/t1/people' })).toBe(true);
		expect(shouldRedirectToWelcome({ ...signedOutPage, method: 'HEAD', pathname: '/' })).toBe(true);
	});

	it('serves the welcome page itself to a signed-out visitor', () => {
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: WELCOME_PATH })).toBe(false);
	});

	it('never redirects a signed-in user', () => {
		expect(shouldRedirectToWelcome({ ...signedOutPage, hasUser: true, pathname: '/' })).toBe(false);
	});

	it('leaves API calls to answer 401', () => {
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: '/api' })).toBe(false);
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: '/api/trees' })).toBe(false);
	});

	it('does not mistake a page that starts with "api" for the API', () => {
		expect(shouldRedirectToWelcome({ ...signedOutPage, pathname: '/apiary' })).toBe(true);
	});

	it('leaves client-side data requests and non-GET methods alone', () => {
		expect(
			shouldRedirectToWelcome({ ...signedOutPage, isDataRequest: true, pathname: '/trees/t1' })
		).toBe(false);
		expect(
			shouldRedirectToWelcome({ ...signedOutPage, method: 'POST', pathname: '/trees/t1' })
		).toBe(false);
	});
});

describe('safeNextPath', () => {
	it('falls back to the root for missing input', () => {
		expect(safeNextPath(null)).toBe('/');
		expect(safeNextPath('')).toBe('/');
	});

	it('keeps a same-site path with its search and hash', () => {
		expect(safeNextPath('/trees/t1?focus=p2')).toBe('/trees/t1?focus=p2');
		expect(safeNextPath('/trees/t1?focus=p2#top')).toBe('/trees/t1?focus=p2#top');
	});

	it.each([
		['a protocol-relative URL', '//evil.example'],
		['a backslash host', '/\\evil.example'],
		['a tab hidden in the slashes', '/\t/evil.example'],
		['an absolute URL', 'https://evil.example'],
		['a script URL', 'javascript:alert(1)'],
		// searchParams.get has already decoded %2F%2F by the time it reaches this function.
		['a decoded encoded protocol-relative URL', decodeURIComponent('%2F%2Fevil.example')]
	])('refuses %s', (_label, raw) => {
		expect(safeNextPath(raw)).toBe('/');
	});

	it('refuses the pages that issue the redirect, so it cannot loop', () => {
		expect(safeNextPath('/login?next=/x')).toBe('/');
		expect(safeNextPath('/login')).toBe('/');
		expect(safeNextPath('/welcome')).toBe('/');
	});

	it('does not treat a longer path as login or welcome', () => {
		expect(safeNextPath('/welcome/extra')).toBe('/welcome/extra');
		expect(safeNextPath('/loginx')).toBe('/loginx');
	});
});
