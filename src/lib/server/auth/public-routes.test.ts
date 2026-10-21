import { describe, it, expect } from 'vitest';
import {
	isPublicTreeSegment,
	isPublicPagePath,
	LOGIN_PATH,
	NOT_INVITED_PATH,
	notAdmittedOutcome,
	publicReadAccess,
	treeIdOfPath,
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
		expect(isPublicPagePath('/account')).toBe(false);
		expect(isPublicPagePath('/admin')).toBe(false);
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
		['a decoded encoded protocol-relative URL', decodeURIComponent('%2F%2Fevil.example')],
		// Dot segments collapse to a leading `//` after the origin check has already passed.
		['a protocol-relative URL behind a dot segment', '/.//evil.com'],
		['a protocol-relative URL behind a parent segment', '/..//evil.com'],
		['a protocol-relative URL behind a nested parent segment', '/a/..//evil.com'],
		// Encoded dots and slashes are decoded by searchParams.get before this function sees them.
		['an encoded dot-segment protocol-relative URL', decodeURIComponent('/%2E%2F%2Fevil.com')]
	])('refuses %s', (_label, raw) => {
		expect(safeNextPath(raw)).toBe('/');
	});

	it('keeps a legitimate path that only looks like a dot segment', () => {
		expect(safeNextPath('/trees/abc?x=1#y')).toBe('/trees/abc?x=1#y');
		expect(safeNextPath('/a/../trees/abc')).toBe('/trees/abc');
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

const notAdmittedPage = { method: 'GET', isDataRequest: false, isNotAdmitted: true };

describe('turning away a visitor Epoch does not admit (ADR-034)', () => {
	it('sends a page load, GET or HEAD, to the not-invited welcome page', () => {
		expect(notAdmittedOutcome({ ...notAdmittedPage, pathname: '/' })).toEqual({
			status: 303,
			location: '/welcome?reason=not-invited'
		});
		expect(
			notAdmittedOutcome({ ...notAdmittedPage, pathname: '/trees/t1', method: 'HEAD' })
		).toEqual({ status: 303, location: NOT_INVITED_PATH });
	});

	it('answers an API call with 403, whatever its method', () => {
		for (const method of ['GET', 'POST', 'DELETE']) {
			expect(notAdmittedOutcome({ ...notAdmittedPage, pathname: '/api/trees', method })).toEqual({
				status: 403
			});
		}
		expect(notAdmittedOutcome({ ...notAdmittedPage, pathname: '/api' })).toEqual({ status: 403 });
	});

	it('leaves data requests and submissions to fail as they do signed out', () => {
		expect(
			notAdmittedOutcome({ ...notAdmittedPage, pathname: '/trees/t1', isDataRequest: true })
		).toBeNull();
		expect(
			notAdmittedOutcome({ ...notAdmittedPage, pathname: '/trees/t1', method: 'POST' })
		).toBeNull();
	});

	it('serves the welcome and login pages, so the redirect cannot loop', () => {
		expect(notAdmittedOutcome({ ...notAdmittedPage, pathname: WELCOME_PATH })).toBeNull();
		expect(notAdmittedOutcome({ ...notAdmittedPage, pathname: LOGIN_PATH })).toBeNull();
	});

	it('does nothing for an admitted or a signed-out request', () => {
		expect(
			notAdmittedOutcome({ ...notAdmittedPage, pathname: '/', isNotAdmitted: false })
		).toBeNull();
	});
});

describe('the public visitor (ADR-041)', () => {
	const anonymous = { method: 'GET', hasToken: false, hasUser: false };

	it('reads the tree id from a tree path and from nothing else', () => {
		expect(treeIdOfPath('/trees/t1')).toBe('t1');
		expect(treeIdOfPath('/trees/t1/people/p9')).toBe('t1');
		expect(treeIdOfPath('/trees/a%20b/x')).toBe('a b');
		expect(treeIdOfPath('/trees/t1~s1/people')).toBe('t1');
		expect(treeIdOfPath('/trees')).toBeNull();
		expect(treeIdOfPath('/trees/')).toBeNull();
		expect(treeIdOfPath('/manage/trees')).toBeNull();
		expect(treeIdOfPath('/other/trees/t1')).toBeNull();
		expect(treeIdOfPath('/trees/%E0%A4%A')).toBeNull();
	});

	it('admits an anonymous read of any API path, and of a tree path pending the lookup', () => {
		expect(publicReadAccess({ ...anonymous, pathname: '/api/trees/t1/summary' })).toEqual({
			kind: 'api'
		});
		expect(publicReadAccess({ ...anonymous, method: 'HEAD', pathname: '/api/trees' })).toEqual({
			kind: 'api'
		});
		expect(publicReadAccess({ ...anonymous, pathname: '/trees/t1/people' })).toEqual({
			kind: 'tree',
			treeId: 't1'
		});
	});

	it('admits nothing else: other pages, writes, or anyone who presented a token or is identified', () => {
		for (const pathname of ['/', '/manage/trees', '/welcome', '/login', '/apix'])
			expect(publicReadAccess({ ...anonymous, pathname })).toBeNull();
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
			expect(
				publicReadAccess({ ...anonymous, method, pathname: '/api/trees/t1/people' })
			).toBeNull();
		expect(publicReadAccess({ ...anonymous, hasToken: true, pathname: '/trees/t1' })).toBeNull();
		expect(publicReadAccess({ ...anonymous, hasUser: true, pathname: '/trees/t1' })).toBeNull();
	});

	it('still sends every other page to the splash, and a write to nothing', () => {
		expect(signedOutRedirect({ ...signedOutPage, pathname: '/manage/trees' })).toBe(
			'/welcome?next=%2Fmanage%2Ftrees'
		);
		expect(signedOutRedirect({ ...signedOutPage, pathname: '/trees/other' })).toBe(
			'/welcome?next=%2Ftrees%2Fother'
		);
		expect(
			signedOutRedirect({ ...signedOutPage, method: 'POST', pathname: '/trees/t1' })
		).toBeNull();
		// Once the hook has made the reader the public visitor, there is a user and nothing redirects.
		expect(
			signedOutRedirect({ ...signedOutPage, hasUser: true, pathname: '/trees/t1' })
		).toBeNull();
	});
});

describe('isPublicTreeSegment', () => {
	const publicTree = { id: 'b8ea1a57-5542-437c-99df-00c5d8ee5970', slug: 'the-windsors' };

	it('matches the public tree by id or by slug', () => {
		expect(isPublicTreeSegment(publicTree, publicTree.id)).toBe(true);
		expect(isPublicTreeSegment(publicTree, 'the-windsors')).toBe(true);
	});

	it('matches nothing else, and nothing when no tree is public', () => {
		expect(isPublicTreeSegment(publicTree, 'the-dacks')).toBe(false);
		expect(isPublicTreeSegment({ ...publicTree, slug: null }, 'the-windsors')).toBe(false);
		expect(isPublicTreeSegment(null, 'the-windsors')).toBe(false);
	});
});
