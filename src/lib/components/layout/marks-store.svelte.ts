/**
 * The user's favourites and recents as the tree screens see them. The mutation endpoints answer
 * with the new lists, so a visit or a toggle updates this in place: re-running the layout load
 * instead would refetch the tree summary (a linear count) and, on the tree page, the graph window
 * behind `parent()`, just to learn one row changed.
 */

import type { MarkedPersonDto, MarksDto } from '#lib/shared/marks.js';

export class MarksStore implements MarksDto {
	favorites = $state<MarkedPersonDto[]>([]);
	recents = $state<MarkedPersonDto[]>([]);

	constructor(initial: MarksDto) {
		this.set(initial);
	}

	set(marks: MarksDto): void {
		this.favorites = marks.favorites;
		this.recents = marks.recents;
	}
}
