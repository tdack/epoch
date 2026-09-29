import type { Sex } from '../../shared/sex';
export interface DateRepresentation {
  raw: string;
  sortStart?: string | null;
  sortEnd?: string | null;
  modifier?: 'EXACT' | 'ABOUT' | 'ESTIMATED' | 'CALCULATED' | 'BEFORE' | 'AFTER' | 'BETWEEN' | 'FROM_TO' | 'UNKNOWN';
}

export interface IndividualRecord {
  id: string; // internal UUID
  treeId: string;
  xrefId?: string | null;
  givenName?: string | null;
  surname?: string | null;
  sex: Sex;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyRecord {
  id: string; // internal UUID
  treeId: string;
  xrefId?: string | null;
  husbandId?: string | null;
  wifeId?: string | null;
  partner1Id?: string | null;
  partner2Id?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRecord {
  id: string; // internal UUID
  treeId: string;
  entityType: 'INDIVIDUAL' | 'FAMILY';
  entityId: string;
  type: string;
  dateRaw?: string | null;
  dateSort?: string | null;
  place?: string | null;
  description?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
