/** docs/DATABASE_SCHEMA.md must match the schemas. If this fails, run: npm run schema:doc */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../scripts/gen-schema-doc.ts';

assert.equal(readFileSync('docs/DATABASE_SCHEMA.md', 'utf8'), render(), 'docs/DATABASE_SCHEMA.md is out of date. Run: npm run schema:doc');
console.log('schema doc is up to date');
