import type { PrivacyFlag } from './privacy';

/** Recents kept per user and tree; older ones are dropped when a newer is recorded. */
export const MAX_RECENTS = 20;

export interface MarkedPersonDto extends PrivacyFlag {
	id: string;
	displayName: string;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
}

export interface MarksDto {
	/** Newest mark first. */
	favorites: MarkedPersonDto[];
	recents: MarkedPersonDto[];
}
