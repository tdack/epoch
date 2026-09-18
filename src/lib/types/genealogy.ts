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
}

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

export interface OpenAddFamilyDefaults {
  husbandId?: string;
  wifeId?: string;
  partner1Id?: string;
  partner2Id?: string;
  childId?: string;
  familyId?: string;
  mode?: 'editFamily' | 'newFamily' | 'addChild';
}

export type ParentChildType = 'biological' | 'adoptive' | 'foster' | 'guardian' | 'unknown';
export type ParentRole = 'parent' | 'mother' | 'father';

export type RelationshipIntent =
  | { kind: 'add_parent'; child: PersonRef; parent: PersonRef; type: ParentChildType; role: ParentRole; unionLabel: string | null }
  | { kind: 'add_child'; parent: PersonRef; child: PersonRef; type: ParentChildType; unionLabel: string | null }
  | { kind: 'add_partner'; person: PersonRef; partner: PersonRef; unionLabel: string | null }
  | { kind: 'record_death'; person: PersonRef; widowedPartners: PersonRef[] }
  | { kind: 'end_union'; person: PersonRef; unionLabel: string };

export interface PersonRef {
  id: string;
  givenName: string | null;
  surname: string | null;
}

export interface RelationshipPlanWarning {
  code: string;
  message: string;
}

export interface RelationshipPlan {
  sentence: string;
  commands: unknown[];
  warnings: RelationshipPlanWarning[];
}

export interface RelationshipGraphPerson {
  id: string;
  displayName: string;
  isDeceased: boolean;
  parentsByUnion: Record<string, Array<{ parentId: string; type: ParentChildType }>>;
  unionIds: string[];
  stepParents: Array<{ stepParentId: string; unionId: string }>;
}

export interface RelationshipGraphUnion {
  id: string;
  status: string;
  partnerIds: string[];
  children: Array<{ childId: string; parentId: string; type: ParentChildType }>;
}

export interface RelationshipGraph {
  people: RelationshipGraphPerson[];
  unions: RelationshipGraphUnion[];
  parentChild: Array<{ parentId: string; childId: string; type: ParentChildType; unionId: string | null }>;
}

export interface PeopleSearchResult {
  id: string;
  givenName: string | null;
  surname: string | null;
}
