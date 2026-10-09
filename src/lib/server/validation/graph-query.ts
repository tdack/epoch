/**
 * The query string of `GET /api/trees/:id/graph?focus=…`. It uses the same names as the page's
 * address (`up`, `down`, `siblings`, `step`, `side`, `origins`, `exp`), so the view's URL can be handed to the
 * endpoint as it is.
 */

import { ValidationError } from '../domain/errors';
import { MAX_VIEW_DEPTH, STUB_TOKEN } from '../../shared/stub-tokens';
import { MAX_COLLATERAL_DEPTH } from '../../tree-layout/types';
import type { FocusWindowOptions } from '../services/focus-window';

/** More opened stubs than a person can click through; bounds the work one request can ask for. */
export const MAX_OPENED_STUBS = 64;

function depth(params: Pick<URLSearchParams, 'get'>, name: 'up' | 'down'): number | undefined {
	const value = params.get(name);
	if (value === null || value === '') return undefined;
	if (!/^\d{1,3}$/.test(value))
		throw new ValidationError(`${name}: must be a whole number from 0 to ${MAX_VIEW_DEPTH}`);
	return Math.min(MAX_VIEW_DEPTH, Number(value));
}

function collateralDepth(params: Pick<URLSearchParams, 'get'>): number | undefined {
	const value = params.get('side');
	if (value === null || value === '') return undefined;
	if (!/^\d{1,3}$/.test(value))
		throw new ValidationError(`side: must be a whole number from 0 to ${MAX_COLLATERAL_DEPTH}`);
	return Math.min(MAX_COLLATERAL_DEPTH, Number(value));
}

function flag(
	params: Pick<URLSearchParams, 'get'>,
	name: 'siblings' | 'step' | 'origins'
): boolean | undefined {
	const value = params.get(name);
	if (value === null || value === '') return undefined;
	if (value !== '0' && value !== '1') throw new ValidationError(`${name}: must be 0 or 1`);
	return value === '1';
}

export interface FocusQuery {
	/** Null when the request did not name a focus; the endpoint refuses that unless it is the whole tree. */
	focusPersonId: string | null;
	options: FocusWindowOptions;
	/** `scope=all` asks for everyone the viewer may see, capped; no focus is needed or used. */
	isWholeTree: boolean;
}

export function parseFocusQuery(params: Pick<URLSearchParams, 'get'>): FocusQuery {
	const scope = params.get('scope');
	if (scope !== null && scope !== '' && scope !== 'all')
		throw new ValidationError('scope: must be all');
	const focus = params.get('focus');
	const tokens = (params.get('exp') ?? '').split(',').filter((token) => STUB_TOKEN.test(token));
	if (tokens.length > MAX_OPENED_STUBS)
		throw new ValidationError(`exp: at most ${MAX_OPENED_STUBS} opened stubs`);
	const options: FocusWindowOptions = {
		...(depth(params, 'up') === undefined ? {} : { ancestorDepth: depth(params, 'up') }),
		...(depth(params, 'down') === undefined ? {} : { descendantDepth: depth(params, 'down') }),
		...(flag(params, 'siblings') === undefined
			? {}
			: { shouldIncludeSiblings: flag(params, 'siblings') }),
		...(flag(params, 'step') === undefined
			? {}
			: { shouldIncludeStepFamilies: flag(params, 'step') }),
		...(collateralDepth(params) === undefined ? {} : { collateralDepth: collateralDepth(params) }),
		...(flag(params, 'origins') === undefined
			? {}
			: { shouldIncludePartnerOrigins: flag(params, 'origins') }),
		...(tokens.length > 0 ? { expandedStubTokens: tokens } : {})
	};
	return { focusPersonId: focus ? focus : null, options, isWholeTree: scope === 'all' };
}
