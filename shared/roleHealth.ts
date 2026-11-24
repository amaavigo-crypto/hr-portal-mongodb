/**
 * Role health: what is worth tidying in a company's roles, worked out from the recommended templates in permissions.ts.
 *
 * Pure TypeScript so the Administration screen and the tests use the same rules. It only suggests: nothing here changes a role.
 * Two kinds of finding:
 *  - "missing role": a recommended role (for example Recruiter or Payroll / Finance) the company does not have yet. Companies created
 *    before a template existed never got it.
 *  - "missing permissions": a default role that lacks permissions its template has. This is how permissions added after the company
 *    was created (announce.manage, home.manage, wellbeing.view ...) are noticed. Some companies remove permissions on purpose, so
 *    these are suggestions with the exact list, never applied on their own.
 */
import { DEFAULT_ROLE_TEMPLATES, isKnownPermission, permissionModule, type RoleDef, type RoleTemplate } from './permissions.js';

export interface MissingRole { kind: 'MISSING_ROLE'; template: RoleTemplate }
export interface MissingPermissions { kind: 'MISSING_PERMISSIONS'; role: RoleDef; template: RoleTemplate; missing: string[] }
export type RoleFinding = MissingRole | MissingPermissions;

const norm = (v: string) => String(v || '').trim().toLowerCase();

/** The company's copy of a template: the seeded role (id ends with the slug) or a role with the same name. */
export function roleForTemplate<R extends Pick<RoleDef, 'id' | 'name'>>(roles: R[], t: Pick<RoleTemplate, 'slug' | 'name'>): R | undefined {
  return roles.find((r) => r.id.endsWith(`_${t.slug}`)) || roles.find((r) => norm(r.name) === norm(t.name));
}

export function roleHealth(roles: RoleDef[], enabledModules: string[], templates: RoleTemplate[] = DEFAULT_ROLE_TEMPLATES): RoleFinding[] {
  const out: RoleFinding[] = [];
  for (const t of templates) {
    if (t.isAdmin) continue;
    const mine = roleForTemplate(roles, t);
    if (!mine) { out.push({ kind: 'MISSING_ROLE', template: t }); continue; }
    if (mine.isAdmin) continue;
    const have = new Set(mine.permissions);
    const missing = t.permissions.filter((p) => {
      if (have.has(p) || !isKnownPermission(p)) return false;
      const mod = permissionModule(p);
      return !mod || enabledModules.includes(mod);
    });
    if (missing.length) out.push({ kind: 'MISSING_PERMISSIONS', role: mine, template: t, missing });
  }
  return out;
}
