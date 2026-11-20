import assert from 'node:assert/strict';
import { DEFAULT_ROLE_TEMPLATES, isKnownPermission, type RoleDef } from '../shared/permissions.ts';
import { roleForTemplate, roleHealth } from '../shared/roleHealth.ts';

const mods = ['document-version-control', 'talent-acquisition'];
const seeded = (cid: string): RoleDef[] => DEFAULT_ROLE_TEMPLATES.map((t) => ({
  id: `${cid}_${t.slug}`, companyId: cid, name: t.name, description: t.description, permissions: [...t.permissions], portal: t.portal,
  isAdmin: !!t.isAdmin, isDefault: true, createdAt: '', updatedAt: '',
}));

// every template permission is real, and the new templates exist
for (const t of DEFAULT_ROLE_TEMPLATES) for (const p of t.permissions) assert.ok(isKnownPermission(p), `${t.slug}:${p}`);
assert.ok(DEFAULT_ROLE_TEMPLATES.some((t) => t.slug === 'recruiter'));
const payroll = DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'payroll-officer')!;
assert.ok(payroll.permissions.includes('payroll.manage'));
// payroll stays out of the HR templates on purpose
for (const slug of ['hr', 'hr-head', 'approver']) assert.ok(!DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === slug)!.permissions.some((p) => p.startsWith('payroll.')));

// a freshly seeded company has nothing to tidy
assert.deepEqual(roleHealth(seeded('c1'), mods), []);

// an older company: no Recruiter / Payroll roles, and Head HR predates announce.manage and wellbeing.view
const old = seeded('c2').filter((r) => !/_(recruiter|payroll-officer)$/.test(r.id));
const head = old.find((r) => r.id.endsWith('_hr-head'))!;
head.permissions = head.permissions.filter((p) => p !== 'announce.manage' && p !== 'wellbeing.view');
const f = roleHealth(old, mods);
assert.deepEqual(f.filter((x) => x.kind === 'MISSING_ROLE').map((x: any) => x.template.slug).sort(), ['payroll-officer', 'recruiter']);
const mp: any = f.find((x) => x.kind === 'MISSING_PERMISSIONS');
assert.equal(mp.role.id, head.id);
assert.deepEqual(mp.missing.sort(), ['announce.manage', 'wellbeing.view']);

// a role the company renamed is still found by its seeded id; a custom role with the template's name also counts
assert.ok(roleForTemplate([{ id: 'c3_recruiter', name: 'Talent partner' }], { slug: 'recruiter', name: 'Recruiter' }));
assert.ok(roleForTemplate([{ id: 'abc', name: ' recruiter ' }], { slug: 'recruiter', name: 'Recruiter' }));
assert.equal(roleForTemplate([{ id: 'abc', name: 'Other' }], { slug: 'recruiter', name: 'Recruiter' }), undefined);

// permissions of a module the company does not use are not suggested
const noHiring = seeded('c4');
const hrRole = noHiring.find((r) => r.id.endsWith('_hr'))!;
hrRole.permissions = hrRole.permissions.filter((p) => !p.startsWith('req.') && !['talent.view', 'candidate.evaluate', 'onboarding.manage', 'app.manage'].includes(p));
assert.ok(!roleHealth(noHiring, ['document-version-control']).some((x: any) => x.kind === 'MISSING_PERMISSIONS' && x.role.id === hrRole.id));
assert.ok(roleHealth(noHiring, mods).some((x: any) => x.kind === 'MISSING_PERMISSIONS' && x.role.id === hrRole.id));

// the company admin role is never touched
const admin = seeded('c5').find((r) => r.isAdmin)!;
admin.permissions = [];
assert.ok(!roleHealth([admin], mods).some((x: any) => x.kind === 'MISSING_PERMISSIONS'));
console.log('role.health: ok');
