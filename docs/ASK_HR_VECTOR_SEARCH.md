# Ask HR vector search setup

Ask HR keeps its existing permission-filtered published-policy list and adds semantic retrieval on top. When a reviewer publishes a version, the frontend calls an authenticated server endpoint that immediately indexes that published version. If immediate indexing fails (for example, OpenAI or Atlas is temporarily unavailable), the existing keyword search remains the fallback and Ask HR retries indexing on a later policy question.

## Environment

Add these server-side environment variables to the Cloud Run service (never expose the OpenAI key to Vite/client code):

```env
OPENAI_API_KEY=your_existing_openai_api_key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
HR_EMBEDDING_DIMENSIONS=768
HR_VECTOR_INDEX_NAME=hr_document_vector_index
```

The embedding endpoint uses the existing server-side OpenAI API key; no additional SDK dependency is required. MongoDB mode must be enabled with the existing `MONGODB_URI` and optional `MONGODB_DB` settings. The vector feature uses the same cached MongoDB connection as the Firestore adapter.

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

- Existing upload, storage and document-publishing flows are not replaced. PDF, DOCX and text uploads can be indexed.
- The ingestion path uses existing published-version content and file data URLs. It extracts text from PDF and DOCX uploads and indexes existing TXT/Markdown/plain-text content; it does not re-upload files or require GridFS.
- Chunks are keyed by company, version, content hash and chunk number, making repeated indexing idempotent.
- Only published versions returned by the employee's existing Home `files` permission check are indexed for retrieval.
- Vector queries filter by `companyId` and `active`, then the assistant applies a second allow-list of version IDs the signed-in employee is allowed to open.
- New chunks are written inactive and activated only after every embedding succeeds. Previous active chunks are then retired.
- After the reviewer publishes a version, the governance flow requests immediate indexing through `/api/assistant/index-published`; the server verifies the signed-in tenant and `doc.publish` permission, then confirms the version belongs to that company and is `PUBLISHED`.
- Indexing failures do not undo an approved publication. Ask HR falls back to the keyword ranker and retries indexing on later policy questions.

## Smoke test

1. Deploy the branch with the server environment variables above.
2. Create the Atlas Vector Search index and wait until its status is READY.
3. Upload a PDF or DOCX HR policy using Document Masters, then approve and publish it.
4. Sign in as an employee who is allowed to open that policy and ask a question phrased differently from the policy wording.
5. Confirm matching policy passages and a policy source are returned.
6. Confirm `hrDocumentChunks` contains records with the correct `companyId`, `versionId`, `active: true`, and a 768-number `embedding` array.
7. Sign in as a user from another company or without access to that policy and confirm the passage is not returned.

Scanned PDFs with no extractable text still require OCR before ingestion. The frontend extracts PDF/DOCX text during upload and saves that text with the version; the indexer uses the saved text, with file extraction as a fallback when a data URL is available. TXT/Markdown uses its saved text content.


## Pipeline logs and troubleshooting

The ingestion and Ask HR flows emit structured JSON logs. Search server/runtime logs for
`[HR_AI_PIPELINE]` and browser DevTools Console for `[HR_DOCUMENT_UPLOAD]` or
`[HR_DOCUMENT_GOVERNANCE]`. Every event includes a timestamp, event name, status and trace ID.
Use the trace ID to follow one operation across its log entries.

Expected document indexing stages:
- `document.index.start`
- `document.text_extraction.start / complete` (DOCX, PDF or text)
- `document.chunking.complete`
- `openai.embedding.request` for each chunk (model, dimensions, duration and token usage; never the key or text)
- `mongodb.chunk_write.start / complete`
- `document.index.complete`

Expected Ask HR stages:
- `assistant.ask.start / complete`
- `openai.chat_completion.request / response` for each model round
- `assistant.tool.execute` for each tool
- `policy.search.start`, `atlas.vector_search.complete` or `policy.search.keyword_fallback`

The logs intentionally exclude raw document contents, prompts, answers, employee personal data,
and API keys. Browser upload logs appear in the browser console; server-side OpenAI, MongoDB,
indexing and chat logs appear in the deployed API/server runtime logs. These are diagnostic
application logs, not a durable audit-log database. Configure the hosting provider's log
retention/export if long-term retention is required.
