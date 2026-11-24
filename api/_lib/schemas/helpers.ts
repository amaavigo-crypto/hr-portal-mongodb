/**
 * Shared helpers for the collection schemas.
 *
 * These schemas are the written data model of the database. They are used for three things only:
 *  1. documentation (one place that says what each collection holds),
 *  2. validating writes inside the MongoDB adapter (log-only by default, see ./index.ts),
 *  3. the non-unique indexes the API's queries rely on.
 *
 * They are deliberately NOT used to read or query data: the adapter keeps using the native driver, so nothing
 * about queries or transactions changes. Mongoose is never connected.
 *
 * Conventions that match how the app really stores data:
 *  - The Firestore document id lives in `_id` (a string) and is not part of the document, so no schema lists `_id`.
 *    Many documents also carry a copy of it as `id`.
 *  - Dates are ISO-8601 strings (`2026-11-24T10:00:00.000Z`) or `YYYY-MM-DD` strings, never Date objects.
 *  - Every tenant-owned record has `companyId`.
 *  - `strict: false`: fields a schema does not list are allowed (and kept). Schemas only constrain what they name.
 */
import { Schema, type SchemaDefinition, type SchemaOptions } from 'mongoose';

export type IndexSpec = [fields: Record<string, 1 | -1>, options?: { name?: string; sparse?: boolean }];

export const Mixed = Schema.Types.Mixed;

/** A required string / number / boolean. */
export const reqStr = { type: String, required: true } as const;
export const reqNum = { type: Number, required: true } as const;
export const reqBool = { type: Boolean, required: true } as const;

/** A string limited to the listed values. */
export const oneOf = (values: readonly string[], required = false) => ({ type: String, enum: values as string[], required });

/** Fields every tenant-owned record has. */
export const tenant = { companyId: reqStr } satisfies SchemaDefinition;

/** `createdAt` / `updatedAt` as ISO strings. */
export const stamps = { createdAt: String, updatedAt: String } satisfies SchemaDefinition;

const OPTIONS: SchemaOptions = {
  _id: false,
  id: false,
  strict: false,
  minimize: false,
  versionKey: false,
  validateBeforeSave: true,
};

/** `kinds` documents the `kind` values a mixed collection (hiringItems, hrbpItems) holds. */
export interface Def {
  schema: Schema;
  /** Extra schemas applied on top when a document's `kind` matches (mixed collections only). */
  kinds?: Record<string, Schema>;
  /** What the collection is for, shown in docs/DATABASE_SCHEMA.md. */
  about: string;
}

export function defineSchema(definition: SchemaDefinition, indexes: IndexSpec[] = []): Schema {
  const s = new Schema(definition, OPTIONS);
  for (const [fields, options] of indexes) s.index(fields, options);
  return s;
}

export const collection = (about: string, schema: Schema, kinds?: Record<string, Schema>): Def => ({ about, schema, kinds });
