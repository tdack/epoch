import { describe, it, expect } from 'vitest';
import {
	isPublicPagePath,
	LOGIN_PATH,
	safeNextPath,
	signedOutRedirect,
	WELCOME_PATH
} from './public-routes';

const signedOutPage = {
	method: 'GET',
	search: '',
	isDataRequest: false,
	hasUser: false,
	hasInvalidToken: false
};

describe('public routes', () => {
	it('lists only the welcome and login pages as public', () => {
		expect(isPublicPagePath(WELCOME_PATH)).toBe(true);
		expect(isPublicPagePath(LOGIN_PATH)).toBe(true);
		expect(isPublicPagePath('/')).toBe(false);
		expect(isPublicPagePath('/welcome/extra')).toBe(false);
		expect(isPublicPagePath('/trees/t1')).toBe(false);
	});

	it('sends a signed-out page load to the welcome page, remembering where it was going', () => {
		expect(signedOutRedirect({ ...signedOutPage, pathname: '/' })).toBe('/welcome?next=%2F');
		expect(
			signedOutRedirect({
				...signedOutPage,
				pathname: '/trees/t1/people',
				search: '?focus=p2&q=a b'
			})
		).toBe('/welcome?next=%2Ftrees%2Ft1%2Fpeople%3Ffocus%3Dp2%26q%3Da%20b');
		expect(signedOutRedirect({ ...signedOutPage, method: 'HEAD', pathname: '/' })).toBe(
			'/welcome?next=%2F'
		);
	});

	it('sends a request whose token failed validation to login instead', () => {
		expect(
			signedOutRedirect({
				...signedOutPage,
				hasInvalidToken: true,
				pathname: '/trees/t1',
				search: '?focus=p2'
			})
		).toBe('/login?next=%2Ftrees%2Ft1%3Ffocus%3Dp2');
	});

	it('serves the welcome and login pages themselves', () => {
		for (const hasInvalidToken of [false, true]) {
			expect(signedOutRedirect({ ...signedOutPage, hasInvalidToken, pathname: WELCOME_PATH })).toBe(
				null
			);
			expect(signedOutRedirect({ ...signedOutPage, hasInvalidToken, pathname: LOGIN_PATH })).toBe(
				null
			);
		}
	});

	it('never redirects a signed-in user', () => {
		expect(signedOutRedirect({ ...signedOutPage, hasUser: true, pathname: '/' })).toBe(null);
	});

	it('leaves API calls to answer 401, even with an invalid token', () => {
		for (const hasInvalidToken of [false, true]) {
			expect(signedOutRedirect({ ...signedOutPage, hasInvalidToken, pathname: '/api' })).toBe(null);
			expect(signedOutRedirect({ ...signedOutPage, hasInvalidToken, pathname: '/api/trees' })).toBe(
				null
			);
		}
	});

	it('does not mistake a page that starts with "api" for the API', () => {
		expect(signedOutRedirect({ ...signedOutPage, pathname: '/apiary' })).toBe(
			'/welcome?next=%2Fapiary'
		);
	});

	it('leaves client-side data requests and non-GET methods alone', () => {
		expect(
			signedOutRedirect({ ...signedOutPage, isDataRequest: true, pathname: '/trees/t1' })
		).toBe(null);
		expect(signedOutRedirect({ ...signedOutPage, method: 'POST', pathname: '/trees/t1' })).toBe(
			null
		);
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
