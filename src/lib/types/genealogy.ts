export interface TreeSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface TreeDetails {
  tree: {
    id: string;
    name: string;
    description?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
  individuals: any[];
  families: any[];
}

export interface ImportPreviewData {
  mode: 'replace' | 'merge';
  deleteCounts?: {
    individuals: number;
    families: number;
    events: number;
    childLinks: number;
  };
  merge?: {
    newIndividuals: number;
    existingIndividuals: number;
    newFamilies: number;
    mergedFamilies: number;
    newChildLinks: number;
    duplicateChildLinks: number;
    newEvents: number;
    duplicateEvents: number;
  };
  incoming: {
    individuals: number;
    families: number;
    events: number;
  };
  /** Families the file repeats: exact ones can be merged on import, possible ones are for review. */
  duplicates: DuplicateFamilyReport;
}

export type { DuplicateFamilyReport, ExactDuplicateGroup, PossibleDuplicateGroup } from '#lib/server/gedcom/duplicate-families.js';
import type { DuplicateFamilyReport } from '#lib/server/gedcom/duplicate-families.js';
export type { ImpactSummary, ImpactPerson } from '#lib/server/domain/impact.js';
export type { RecordChange } from '#lib/server/domain/change-log.js';
export type { UnionEventInput, UnionEventType, EndedUnionStatus } from '#lib/shared/union-events.js';
import type { ImpactSummary } from '#lib/server/domain/impact.js';
import type { EndedUnionStatus, UnionEventType } from '#lib/shared/union-events.js';

export interface PersonFormData {
  givenName?: string | null;
  surname?: string | null;
  sex: 'M' | 'F' | 'U';
  birthDate?: string | null;
  birthPlace?: string | null;
  deathDate?: string | null;
  deathPlace?: string | null;
}

export interface FamilyFormData {
  partner1Id?: string;
  partner2Id?: string;
  husbandId?: string;
  wifeId?: string;
  childrenIds: string[];
  marriageDate?: string;
  marriagePlace?: string;
  divorceDate?: string;
  divorcePlace?: string;
}

export type ParentChildType = 'biological' | 'adoptive' | 'foster' | 'guardian' | 'unknown';
export type ParentRole = 'parent' | 'mother' | 'father';

export type RelationshipIntent =
  | { kind: 'add_parent'; child: PersonRef; parent: PersonRef; type: ParentChildType; role: ParentRole; unionLabel: string | null }
  | { kind: 'add_child'; parent: PersonRef; child: PersonRef; type: ParentChildType; unionLabel: string | null }
  | { kind: 'add_partner'; person: PersonRef; partner: PersonRef; unionLabel: string | null }
  | { kind: 'record_death'; person: PersonRef; dateText: string | null; place: string | null; personVersion?: number }
  | {
      kind: 'end_union';
      person: PersonRef;
      unionId: string | null;
      status: EndedUnionStatus;
      event: { type: UnionEventType; dateText: string | null; place: string | null } | null;
      unionVersion?: number;
    };

/** What the relationship editor can record about a person. */
export type RelationshipKind = 'add_parent' | 'add_child' | 'add_partner' | 'record_death' | 'end_union';

export interface PersonRef {
  id: string;
  givenName: string | null;
  surname: string | null;
  /** True for someone the intent creates; the server replaces `id`. */
  isNew?: boolean;
}

export interface RelationshipPlanWarning {
  code: string;
  message: string;
}

export interface RelationshipPlan {
  sentence: string;
  commands: unknown[];
  warnings: RelationshipPlanWarning[];
  /** Present on previews: exactly which records the save would write. */
  impact?: ImpactSummary;
}

/** The change-log entry a mutation returns; the toast offers Undo when `isUndoable`. */
export interface ChangeSummary {
  id: string;
  kind: string;
  summary: string;
  isUndoable: boolean;
}

// The relationship graph types are shared with the server domain (pure, no I/O).
export type {
  RelationshipGraph,
  RelationshipGraphPerson,
  RelationshipGraphUnion
} from '#lib/server/domain/relationship-graph.js';

export interface PeopleSearchResult {
  id: string;
  givenName: string | null;
  surname: string | null;
}
