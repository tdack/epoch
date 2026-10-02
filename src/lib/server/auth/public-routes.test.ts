import { describe, it, expect } from 'vitest';
import { isPublicPagePath, shouldRedirectToWelcome, WELCOME_PATH } from './public-routes';

const signedOutPage = { method: 'GET', isDataRequest: false, hasUser: false };

describe('public routes', () => {
	it('lists only the welcome page as public', () => {
		expect(isPublicPagePath(WELCOME_PATH)).toBe(true);
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
