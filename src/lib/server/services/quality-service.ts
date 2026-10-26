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
import { NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { omitForScope } from '../domain/privacy-mask';
import { checkConnections, checkQuality } from '../domain/quality-checks';
import { checkPrivacyLeaks } from '../domain/quality-privacy';
import { isManagerOrAbove } from '../../shared/roles';
import { TaskReadService } from './task-read-service';
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
import { requireRealUser, requireTreeScope, type ViewerScope } from './tree-access';

const RULE_ORDER = new Map<string, number>(QUALITY_RULES.map((rule, i) => [rule.code, i]));
const SEVERITY_ORDER = new Map<string, number>(
	QUALITY_SEVERITY_ORDER.map((severity, i) => [severity, i])
);

export class QualityService {
	private store: ChangeStore;
	private dismissals: QualityRepository;
	private tasks: TaskReadService;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => number = () => Date.now()
	) {
		this.tasks = new TaskReadService(db, () => new Date(this.now()));
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
	): Promise<{ findings: QualityFinding[]; scope: ViewerScope }> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			action,
			new Date(this.now())
		);
		const rows = await this.store.loadRows(treeId);
		// The privacy-leak checks read every row and name the private person they are about, so only a
		// manager or owner is shown them (ADR-029).
		const leaks = isManagerOrAbove(scope.role) ? checkPrivacyLeaks(rows, scope.cutoff) : [];
		// Over every row, so a viewer who sees everyone gets it; to anyone else a person joined only
		// through someone hidden would look detached.
		const detached = scope.isRestricted ? [] : checkConnections(rows);
		const findings = [...checkQuality(omitForScope(rows, scope)), ...leaks, ...detached].sort(
			(a, b) =>
				(SEVERITY_ORDER.get(a.severity) ?? 0) - (SEVERITY_ORDER.get(b.severity) ?? 0) ||
				(RULE_ORDER.get(a.rule) ?? 0) - (RULE_ORDER.get(b.rule) ?? 0) ||
				a.key.localeCompare(b.key)
		);
		return { findings, scope };
	}

	async report(treeId: string, context: AuthenticatedContext): Promise<QualityReport> {
		const [{ findings: all, scope }, dismissals] = await Promise.all([
			this.visibleFindings(treeId, context, 'tree:view'),
			this.dismissals.list(treeId)
		]);
		// A finding that has a task says so; completing the task does not dismiss the finding, and
		// dismissing the finding does not touch the task: they are separate decisions (ADR-029).
		// A working report, with who may take each task: for the tree's own members, not its readers.
		if (scope.isOutsider)
			throw new UnauthorizedError('Forbidden: the quality report is for members of this tree');
		const taskOf = await this.tasks.tasksByFinding(treeId, scope);
		const byKey = new Map(all.map((f) => [f.key, f]));
		const reasonOf = new Map(dismissals.map((d) => [d.key, d]));

		const counts: Record<string, number> = {};
		const findings: QualityFinding[] = [];
		for (const finding of all) {
			if (reasonOf.has(finding.key)) continue;
			counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
			if (counts[finding.rule]! <= MAX_FINDINGS_PER_RULE)
				findings.push(taskOf[finding.key] ? { ...finding, task: taskOf[finding.key] } : finding);
		}
		return {
			members: await this.tasks.memberChoices(treeId),
			findings,
			counts,
			truncatedRules: Object.keys(counts).filter((rule) => counts[rule]! > MAX_FINDINGS_PER_RULE),
			dismissed: dismissals.flatMap((d) =>
				byKey.has(d.key) ? [{ ...d, finding: byKey.get(d.key)! }] : []
			)
		};
	}

	/**
	 * Dismisses every finding named with the one reason, or none of them.
	 *
	 * @throws NotFoundError when a finding does not exist now (it was fixed, or it is about someone the caller cannot see).
	 */
	async dismiss(
		treeId: string,
		findingKeys: string | string[],
		reason: string,
		context: AuthenticatedContext
	): Promise<void> {
		const keys = [...new Set(typeof findingKeys === 'string' ? [findingKeys] : findingKeys)];
		if (keys.length === 0) throw new ValidationError('Choose at least one finding to dismiss.');
		requireRealUser(context);
		const trimmed = reason.trim();
		if (!trimmed) throw new ValidationError('Say why this is fine, so the next person knows.');
		if (trimmed.length > MAX_DISMISSAL_REASON_LENGTH)
			throw new ValidationError(
				`The reason can be at most ${MAX_DISMISSAL_REASON_LENGTH} characters.`
			);
		const { findings: all } = await this.visibleFindings(treeId, context, 'record:edit');
		const existing = new Set(all.map((f) => f.key));
		const missing = keys.find((key) => !existing.has(key));
		if (missing !== undefined) throw new NotFoundError('Finding', missing);
		await this.dismissals.dismiss(treeId, keys, trimmed, context.user.id, this.now());
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
