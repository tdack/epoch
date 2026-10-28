import { afterEach, describe, expect, it, vi } from 'vitest';
import { canPullFrom, PULL_THRESHOLD_PX, pullToRefresh } from './pull-to-refresh';

afterEach(() => {
	document.body.innerHTML = '';
});

function touch(type: string, target: EventTarget, clientY?: number) {
	const event = new Event(type, { bubbles: true }) as TouchEvent;
	const touches = clientY === undefined ? [] : [{ clientY }];
	Object.defineProperty(event, 'touches', { value: touches });
	target.dispatchEvent(event);
}

describe('pullToRefresh', () => {
	function pull(endType: string, fromY: number, toY: number, target: EventTarget = document.body) {
		const onrefresh = vi.fn();
		const distances: number[] = [];
		const stop = pullToRefresh((d) => distances.push(d), onrefresh);
		touch('touchstart', target, fromY);
		touch('touchmove', target, toY);
		touch(endType, target);
		stop();
		return { onrefresh, distances };
	}

	it('refreshes when let go past the threshold, and resets the indicator', () => {
		const { onrefresh, distances } = pull('touchend', 10, 10 + PULL_THRESHOLD_PX * 2 + 1);
		expect(onrefresh).toHaveBeenCalledOnce();
		expect(distances.at(-1)).toBe(0);
	});

	it('does not refresh a short pull or a cancelled one', () => {
		expect(pull('touchend', 10, 10 + PULL_THRESHOLD_PX).onrefresh).not.toHaveBeenCalled();
		expect(pull('touchcancel', 10, 500).onrefresh).not.toHaveBeenCalled();
	});

	it('ignores a pull that starts on a surface that pans itself', () => {
		document.body.innerHTML = '<div style="touch-action: none"><span id="chart"></span></div>';
		const { onrefresh, distances } = pull('touchend', 10, 500, document.getElementById('chart')!);
		expect(onrefresh).not.toHaveBeenCalled();
		expect(distances).toEqual([0]);
	});
});

describe('canPullFrom', () => {
	it('refuses inside a scrolled panel, where the pull scrolls it back up', () => {
		document.body.innerHTML = '<div id="panel"><span id="row"></span></div>';
		const panel = document.getElementById('panel')!;
		expect(canPullFrom(document.getElementById('row'))).toBe(true);
		Object.defineProperty(panel, 'scrollTop', { value: 40 });
		expect(canPullFrom(document.getElementById('row'))).toBe(false);
	});
});
