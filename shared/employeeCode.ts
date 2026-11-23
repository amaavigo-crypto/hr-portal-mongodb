/**
 * Employee codes (the "AMAA006" label shown under a person's role).
 *
 * The code is a display label; people are keyed by their uid everywhere, so changing a code never breaks a record.
 * These rules keep codes tidy and unique inside one company. Used by the server (lifecycleApi, tenantAdmin) and the tests.
 */

export const CODE_MIN = 2;
export const CODE_MAX = 20;

/** Trim and upper-case, so "amaa006 " and "AMAA006" are the same code. */
export const normalizeEmployeeCode = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/** '' when the code is acceptable, otherwise a sentence the person can act on. */
export function employeeCodeProblem(v: unknown): string {
  const code = normalizeEmployeeCode(v);
  if (!code) return 'Enter an employee code.';
  if (code.length < CODE_MIN || code.length > CODE_MAX) return `The code must be ${CODE_MIN} to ${CODE_MAX} characters long.`;
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) return 'Use only letters, numbers, "-" or "_", starting with a letter or number.';
  return '';
}

export const sameEmployeeCode = (a: unknown, b: unknown): boolean => {
  const x = normalizeEmployeeCode(a);
  return x !== '' && x === normalizeEmployeeCode(b);
};

/**
 * The next code from a counter that is not already taken. Hand-edited codes can land on a number the counter has not
 * reached yet; this skips them instead of creating a duplicate. Returns the code and the number actually used.
 */
export function nextFreeEmployeeCode(prefix: string, startNumber: number, taken: Iterable<string>, pad = 3): { code: string; number: number } {
  const used = new Set<string>();
  for (const t of taken) used.add(normalizeEmployeeCode(t));
  let n = Math.max(1, Math.floor(startNumber) || 1);
  for (let i = 0; i < 100000; i++, n++) {
    const code = `${prefix}${String(n).padStart(pad, '0')}`;
    if (!used.has(normalizeEmployeeCode(code))) return { code, number: n };
  }
  throw new Error('No free employee code is left for this prefix.');
}
