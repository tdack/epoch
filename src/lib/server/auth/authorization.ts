import type { TreeRole } from '../domain/identity';

/**
 * Role hierarchy levels for permission comparisons:
 * viewer (1) < contributor (2) < editor (3) < manager (4) < owner (5)
 */
export const ROLE_HIERARCHY: Record<TreeRole, number> = {
  viewer: 1,
  contributor: 2,
  editor: 3,
  manager: 4,
  owner: 5
};

export type TreeAction =
  | 'tree:view'
  | 'tree:export'
  | 'tree:import'
  | 'tree:manage_members'
  | 'tree:delete'
  | 'tree:update_settings'
  | 'record:create'
  | 'record:edit'
  | 'record:delete';

const ACTION_MIN_ROLES: Record<TreeAction, TreeRole> = {
  'tree:view': 'viewer',
  'tree:export': 'viewer',
  'record:create': 'contributor',
  'record:edit': 'editor',
  'record:delete': 'editor',
  'tree:import': 'editor',
  'tree:update_settings': 'manager',
  'tree:manage_members': 'manager',
  'tree:delete': 'owner'
};

export function hasMinimumRole(actualRole: TreeRole, requiredRole: TreeRole): boolean {
  return ROLE_HIERARCHY[actualRole] >= ROLE_HIERARCHY[requiredRole];
}

export function isActionAllowed(actualRole: TreeRole | undefined | null, action: TreeAction): boolean {
  if (!actualRole) return false;
  const minRequired = ACTION_MIN_ROLES[action];
  return hasMinimumRole(actualRole, minRequired);
}
