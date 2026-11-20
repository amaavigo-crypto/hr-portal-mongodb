# Ask HR vector search setup

Ask HR keeps its existing permission-filtered published-policy list and adds semantic retrieval on top. The first Ask HR policy search indexes any permitted published version that is not yet indexed. If Gemini or Atlas is unavailable, the existing keyword search remains the fallback.

## Environment

Add these server-side environment variables to the Cloud Run service (never expose the Gemini key to Vite/client code):

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
HR_EMBEDDING_DIMENSIONS=768
HR_VECTOR_INDEX_NAME=hr_document_vector_index
```

The repository already includes `@google/genai`. MongoDB mode must be enabled with the existing `MONGODB_URI` and optional `MONGODB_DB` settings. The vector feature uses the same cached MongoDB connection as the Firestore adapter.

## Atlas Vector Search index

In MongoDB Atlas, open the database configured by `MONGODB_DB` (default: `hr_governance`), collection `hrDocumentChunks`, then create a Vector Search index named `hr_document_vector_index` (or the value of `HR_VECTOR_INDEX_NAME`).

Use this index definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "companyId" },
    { "type": "filter", "path": "active" }
  ]
}
```

If `HR_EMBEDDING_DIMENSIONS` changes, the Atlas index dimensions must match and all chunks must be re-embedded.

## Behaviour and safeguards

- Existing upload, storage and document-publishing flows are not replaced.
- The ingestion path uses existing published-version content and file data URLs. It extracts text from PDF and DOCX uploads and indexes existing TXT/Markdown/plain-text content; it does not re-upload files or require GridFS.
- Chunks are keyed by company, version, content hash and chunk number, making repeated indexing idempotent.
- Only published versions returned by the employee's existing Home `files` permission check are indexed for retrieval.
- Vector queries filter by `companyId` and `active`, then the assistant applies a second allow-list of version IDs the signed-in employee is allowed to open.
- New chunks are written inactive and activated only after every embedding succeeds. Previous active chunks are then retired.
- If Gemini or Atlas Vector Search is unavailable, Ask HR falls back to the current keyword ranker. Indexing is retried on later policy questions.
- This first implementation performs indexing on the first Ask HR policy lookup after a version is published (lazy ingestion), not synchronously in the publish button request. Existing publishing is therefore not blocked by embedding service failures.

## Smoke test

1. Deploy the branch with the server environment variables above.
2. Create the Atlas Vector Search index and wait until its status is READY.
3. Publish a text-based HR policy using the existing Document Masters flow.
4. Sign in as an employee who is allowed to open that policy and ask a question phrased differently from the policy wording.
5. Confirm matching policy passages and a policy source are returned.
6. Confirm `hrDocumentChunks` contains records with the correct `companyId`, `versionId`, `active: true`, and a 768-number `embedding` array.
7. Sign in as a user from another company or without access to that policy and confirm the passage is not returned.

Scanned PDFs with no extractable text still require OCR before ingestion. PDF/DOCX extraction requires the stored file data URL to be available on the published version; TXT/Markdown uses its saved text content.
