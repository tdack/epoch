/**
 * The data-quality report (Phase 5): every rule run over the rows the viewer may see, minus what
 * someone has dismissed with a reason. Findings are computed on each request and never stored, so
 * the report is always about the tree as it is; only dismissals persist.
 *
 * Reading needs `tree:view`. The rows are masked first for a restricted viewer (ADR-015), so a
 * finding can name nobody they may not, and a rule cannot hint at a hidden person by firing.
 * Dismissing and restoring need `record:edit`.
 */

import type { DbClient } from '../db';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { maskRows } from '../domain/privacy-mask';
import { checkQuality } from '../domain/quality-checks';
import { ChangeStore } from '../repositories/change-store';
import { QualityRepository } from '../repositories/quality-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	MAX_DISMISSAL_REASON_LENGTH,
	MAX_FINDINGS_PER_RULE,
	QUALITY_RULES,
	QUALITY_SEVERITY_ORDER,
	type QualityFinding,
	type QualityReport
} from '../../shared/quality';
import { requireTreeScope } from './tree-access';

const RULE_ORDER = new Map<string, number>(QUALITY_RULES.map((rule, i) => [rule.code, i]));
const SEVERITY_ORDER = new Map<string, number>(
	QUALITY_SEVERITY_ORDER.map((severity, i) => [severity, i])
);

export class QualityService {
	private store: ChangeStore;
	private dismissals: QualityRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => number = () => Date.now()
	) {
		this.store = new ChangeStore(db);
		this.dismissals = new QualityRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	/** Every finding the viewer may see, dismissed or not, in the order the report lists them. */
	private async visibleFindings(
		treeId: string,
		context: AuthenticatedContext,
		action: 'tree:view' | 'record:edit'
	): Promise<QualityFinding[]> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			action,
			new Date(this.now())
		);
		const rows = await this.store.loadRows(treeId);
		const visible = scope.isRestricted
			? maskRows(rows, scope.cutoff, false, scope.creatorId).rows
			: rows;
		return checkQuality(visible).sort(
			(a, b) =>
				(SEVERITY_ORDER.get(a.severity) ?? 0) - (SEVERITY_ORDER.get(b.severity) ?? 0) ||
				(RULE_ORDER.get(a.rule) ?? 0) - (RULE_ORDER.get(b.rule) ?? 0) ||
				a.key.localeCompare(b.key)
		);
	}

	async report(treeId: string, context: AuthenticatedContext): Promise<QualityReport> {
		const [all, dismissals] = await Promise.all([
			this.visibleFindings(treeId, context, 'tree:view'),
			this.dismissals.list(treeId)
		]);
		const byKey = new Map(all.map((f) => [f.key, f]));
		const reasonOf = new Map(dismissals.map((d) => [d.key, d]));

		const counts: Record<string, number> = {};
		const findings: QualityFinding[] = [];
		for (const finding of all) {
			if (reasonOf.has(finding.key)) continue;
			counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
			if (counts[finding.rule]! <= MAX_FINDINGS_PER_RULE) findings.push(finding);
		}
		return {
			findings,
			counts,
			truncatedRules: Object.keys(counts).filter((rule) => counts[rule]! > MAX_FINDINGS_PER_RULE),
			dismissed: dismissals.flatMap((d) =>
				byKey.has(d.key) ? [{ ...d, finding: byKey.get(d.key)! }] : []
			)
		};
	}

	/** @throws NotFoundError when the finding does not exist now (it was fixed, or it is about someone the caller cannot see). */
	async dismiss(
		treeId: string,
		findingKey: string,
		reason: string,
		context: AuthenticatedContext
	): Promise<void> {
		const trimmed = reason.trim();
		if (!trimmed) throw new ValidationError('Say why this is fine, so the next person knows.');
		if (trimmed.length > MAX_DISMISSAL_REASON_LENGTH)
			throw new ValidationError(
				`The reason can be at most ${MAX_DISMISSAL_REASON_LENGTH} characters.`
			);
		const all = await this.visibleFindings(treeId, context, 'record:edit');
		if (!all.some((f) => f.key === findingKey)) throw new NotFoundError('Finding', findingKey);
		await this.dismissals.dismiss(treeId, findingKey, trimmed, context.user.id, this.now());
	}

	async restore(treeId: string, findingKey: string, context: AuthenticatedContext): Promise<void> {
		await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'record:edit',
			new Date(this.now())
		);
		if (!(await this.dismissals.restore(treeId, findingKey)))
			throw new NotFoundError('Dismissal', findingKey);
	}
}
