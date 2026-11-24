import assert from 'node:assert/strict';
import { experienceYears, noticeDays, cleanExtraction } from '../shared/resumeAi.js';
import { fallbackQuestions, panelFallback } from '../api/_lib/aiHiringApi.js';

// overlapping jobs counted once, gap not counted
assert.equal(experienceYears([{ company: 'A', role: 'x', from: '2020-01', to: '2021-12' }, { company: 'B', role: 'y', from: '2021-06', to: '2022-12' }] as any, '2026-01'), 3);
assert.equal(experienceYears([{ company: 'A', role: 'x', from: '2020-01', to: '2020-12' }, { company: 'B', role: 'y', from: '2022-01', to: '2022-12' }] as any, '2026-01'), 2);
assert.equal(experienceYears([{ company: 'A', role: 'x', from: '2025-01', to: 'present' }] as any, '2026-01'), 1.1);
assert.equal(experienceYears([], '2026-01'), null);
assert.equal(experienceYears([{ company: 'A', role: 'x', from: 'bad', to: 'worse' }] as any, '2026-01'), null);

assert.equal(noticeDays('30 days'), 30);
assert.equal(noticeDays('2 months'), 60);
assert.equal(noticeDays('6 weeks'), 42);
assert.equal(noticeDays('Immediate'), 0);
assert.equal(noticeDays('negotiable'), null);
assert.equal(noticeDays(''), null);

const ex = cleanExtraction({ skills: ['a'], noticePeriod: '45 days', history: [] });
assert.equal(ex.noticePeriod, '45 days');
assert.equal(ex.noticePeriodDays, 45);

const q = fallbackQuestions('Accountant', ['Tally', 'GST'], 1, 1);
assert.ok(q.length >= 5 && q.length <= 10);
assert.ok(q.some((x) => x.question.includes('Tally')) && q.some((x) => x.area === 'History'));
assert.ok(!fallbackQuestions('Accountant', [], 0, 0).some((x) => x.area === 'History'));

const p = panelFallback('Hire', 7, ['Interview average 4.2.'], ['assessment'], 1);
assert.ok(p.startsWith('Hire (7 points).') && p.includes('1 interview is still waiting') && p.includes('assessment'));
console.log('hiring.phase4 ok');
