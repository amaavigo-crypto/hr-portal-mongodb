import assert from 'node:assert/strict';
import { claimFlags, cleanScan, gstinValid, normGstin, suggestCategory } from '../shared/claimScan.ts';

assert.equal(gstinValid('27AAPFU0939F1ZV'), true, 'a well-known sample number');
assert.equal(gstinValid('27aapfu0939f1zv'), true, 'case and spaces do not matter');
assert.equal(gstinValid('27AAPFU0939F1ZX'), false, 'wrong check digit');
assert.equal(gstinValid('99AAPFU0939F1ZV'), false, 'state 99 shape ok but check digit differs');
assert.equal(gstinValid('12345'), false);
assert.equal(normGstin(' 27 aapfu0939f1zv '), '27AAPFU0939F1ZV');

const cats = ['Travel', 'Food', 'Fuel', 'Phone and internet', 'Medical', 'Office supplies', 'Other'];
const today = '2026-11-17';
let s = cleanScan({ amount: '4,850.50', date: '2026-11-14', vendor: ' Grand Hotel ', gstin: '27AAPFU0939F1ZV', category: 'travel', confidence: {} }, { today, categories: cats });
assert.equal(s.amount, 4850.5); assert.equal(s.date, '2026-11-14'); assert.equal(s.vendor, 'Grand Hotel'); assert.equal(s.gstinValid, true); assert.equal(s.category, 'Travel'); assert.deepEqual(s.unclear, []);
s = cleanScan({ amount: 90, date: '2027-01-01', vendor: 'X', gstin: '', category: 'Spa', confidence: { amount: 'low', vendor: 'low' } }, { today, categories: cats });
assert.equal(s.amount, null, 'low confidence is blanked'); assert.equal(s.date, '', 'future date blanked'); assert.equal(s.vendor, ''); assert.equal(s.category, '', 'category must be one of the company list');
assert.deepEqual(s.unclear.sort(), ['amount', 'date', 'gstin', 'vendor']);
assert.equal(cleanScan({ amount: -5, date: '2025-01-01' }, { today, categories: cats }).amount, null);
assert.equal(cleanScan({ date: '2025-01-01' }, { today, categories: cats }).date, '', 'older than a year blanked');

assert.deepEqual(suggestCategory('Grand Hotel', cats, []), { category: 'Travel', reason: 'KEYWORD' });
assert.deepEqual(suggestCategory('Shree Biryani House', cats, []), { category: 'Food', reason: 'KEYWORD' });
assert.deepEqual(suggestCategory('Shree Biryani House Pvt Ltd', cats, [{ vendor: 'shree biryani house', category: 'Office supplies' }]), { category: 'Office supplies', reason: 'HISTORY' }, 'company history beats keywords');
assert.deepEqual(suggestCategory('Zzz', cats, []), { category: '', reason: '' });
assert.equal(suggestCategory('Grand Hotel', ['Other'], []).category, '', 'only categories the company has');

const base = { uid: 'u1', amount: 1000, expenseDate: '2026-11-10' };
const others = [
  { id: 'abcd1111', uid: 'u1', amount: 1000, expenseDate: '2026-11-10', vendor: 'Grand Hotel', status: 'SUBMITTED', billHash: 'H1' },
  { id: 'zzzz2222', uid: 'u2', amount: 500, expenseDate: '2026-11-09', status: 'REJECTED', billHash: 'H2' },
];
let f = claimFlags({ ...base, id: 'new1', billHash: 'H1' }, null, others);
assert.equal(f[0].kind, 'DUPLICATE_FILE'); assert.ok(f[0].text.includes('CLM-1111') && f[0].text.includes('same person'));
f = claimFlags({ ...base, id: 'new1', billHash: 'H9', vendor: 'GRAND HOTEL Pvt Ltd' }, null, others);
assert.equal(f[0].kind, 'DUPLICATE_DETAILS');
f = claimFlags({ ...base, id: 'new1', billHash: 'H2' }, null, others);
assert.equal(f.length, 0, 'a rejected claim is not a duplicate');
f = claimFlags({ ...base, id: 'n', amount: 1200 }, { amount: 1000, date: '2026-11-11', gstin: 'BAD', gstinValid: false }, []);
assert.deepEqual(f.map((x) => x.kind).sort(), ['AMOUNT_MISMATCH', 'DATE_MISMATCH', 'GSTIN_INVALID']);
assert.equal(claimFlags({ ...base, id: 'n', amount: 1005 }, { amount: 1000 }, []).length, 0, 'tiny difference is fine (0.5 percent)');
console.log('claim scan tests passed');
