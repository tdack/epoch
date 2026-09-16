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
