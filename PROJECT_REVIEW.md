# UniCheatSheet AI — in-depth review

Reviewed on 28 September 2026 against the current code and PROJECT_AND_WEBSITE_INTEGRATION.md.

**Assessment:** the prototype can generate useful cited answers, but its retrieval reliability, source lifecycle, conversation handling, and production operations need work before connection to the main website. The highest-priority changes can be implemented inside this AI repository. No redesign of UniCheatSheet.com, replacement of its account/payment system, or migration of its database is proposed.

This review changes documentation only. It used an isolated PostgreSQL database, `ucs_ai_review_20260928`, for integration tests and new-paper indexing. Browser checks added an audit conversation to the existing local playground. The three new Drive folders were inspected and copied into the ignored `data/temp/project-review-drive` directory; the normal catalog and index were not changed.

## Evidence and limits

| Check | Result |
| --- | --- |
| TypeScript checks | Passed: `pnpm typecheck`. |
| Existing unit tests | 14 passed. |
| Existing integration tests | 10 passed after applying all 7 migrations to the isolated review database. These use mock generation. |
| Real Gemini call through the browser | Answered “What is a database schema?” with citations. The page-51 citation contained the stated definition. |
| Immediate follow-up | “What is it used for?” returned no relevant material despite the preceding schema answer. |
| Home history button | Clicked; no history appeared. |
| Navigation during generation | Clicking Home while an answer was generating ultimately left the browser back on the old conversation. |
| Citation drawer | Loaded the correct passage, but keyboard focus stayed on the source button behind the modal. |
| Responsive view | Inspected desktop and 390 × 844 mobile view; basic layout fits. Physical-device keyboard, screen-reader, and all breakpoint testing remain outstanding. |
| Package audit | 4 high and 2 moderate entries, 0 critical. These are package advisories, not six demonstrated application exploits. |
| New Drive material | 10 PDFs, 31 physical PDF pages. Nine indexed successfully into 29 chunks. One two-page PDF requires OCR. |
| Supported-topic retrieval probes | DMA and Maxwell equations returned results; Flynn taxonomy and Hall coefficient returned none at the configured 0.30 threshold. An unrelated cake query correctly returned none. |
| Public integration | Not tested: main website backend, main Drive identity, DNS/TLS, real website-issued tokens, and production traffic are not connected here. |

The new folders contain:

| Folder | Material | Result |
| --- | --- | --- |
| [Architecture](https://drive.google.com/drive/folders/1889Q05DBnp5Otvh_usNMrcV63cFKJrg5) | 3 Computer System/Organization and Architecture exam PDFs | All three indexed in the review database; one PDF has a page with no extracted text. Whether that page is blank or contains an image needs visual review. |
| [Digital Electronics](https://drive.google.com/drive/folders/1Y2TeHwEfSp0qvQEKSYT0k7ofGAYwXMNe) | 2 exam PDFs | B.Sc. Semester I 2023 paper extracts; B.Tech Semester II 2024 paper returns zero text on both pages and fails indexing with OCR_REQUIRED. |
| [Physics](https://drive.google.com/drive/folders/1ScTwMDG5IY2GXlLHH2tAKJf07EqNpzW6) | 5 exam PDFs | All five indexed; mathematical notation is visibly corrupted in extracted text. |

These folders demonstrate real missing capabilities. They are not proof that all courses or production documents are covered. Review course/program mappings before importing them into the normal catalog. The review used temporary course IDs to avoid inventing production entitlement IDs.

## Priority definitions

- **P1:** address before a shared/public pilot because it causes substantial incorrect behavior, stale access/content, or uncontrolled service usage.
- **P2:** meaningful reliability, quality, accessibility, or maintenance issue; resolve in the next implementation stages.
- **P3:** useful product polish or scale improvement.
- **Reproduced** means exercised against the app or an isolated probe. **Code finding** means the failure follows from the inspected path but was not exercised under every production condition.

## AI and RAG findings

### 1. P1 — Follow-up retrieval loses the conversation topic (reproduced)

The current message alone is passed to `retrievalQuery()`. History is used only after retrieval, when building the model prompt. When a follow-up retrieves nothing, the code bypasses Gemini completely and returns the fixed no-source answer. A successful schema answer followed by “What is it used for?” reproduced this failure.

**Fix:** build a standalone retrieval question from bounded conversation context, or reuse the previous topic/sources for clearly referential follow-ups. Reapply current course permissions to every reused source. Test follow-ups for answer relevance, not just stored message count.

Evidence: [chat-service.ts:50](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/chat-service.ts:50), [query-router.ts:10](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/query-router.ts:10), [chat.integration.test.ts:36](C:/Users/AYUSH/Documents/unicheatsheetAI/tests/chat.integration.test.ts:36).

### 2. P1 — Real exam topics are missed by dense-only retrieval (reproduced)

In the newly supplied papers, “Flynn taxonomy” is explicitly present in the 2024 Architecture paper, page 2, but its best score was **0.1182** and no hit survived. “Hall coefficient” is present in the 2024 Physics paper, page 2, but its score was **0.2991**, just below 0.30. Both returned no results. These are false negatives, not missing source documents.

**Fix:** add lexical matching alongside embeddings, combine rankings, retrieve a larger candidate pool, and rerank/diversify before choosing context. Split exam pages into question-level passages with shared paper metadata. Evaluate exact terms, abbreviations, paraphrases, and negatives before retuning the threshold. Simply lowering the threshold globally could introduce unrelated evidence.

Evidence: [index.ts:30](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/retrieval/src/index.ts:30), [index.ts:61](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/retrieval/src/index.ts:61). Detailed probe results are in the ignored review artifacts.

### 3. P1 — Chunk size exceeds the embedding input limit (reproduced)

Chunks are allowed up to 600 estimated tokens, while the installed MiniLM tokenizer has a 512-token maximum. A probe produced two valid single chunks with 530 repeated short words and different ending topics; their vectors were exactly identical. Text after truncation can therefore be searchable in the database but absent from its vector representation. Character-based estimates also diverge substantially for equations and code.

**Fix:** chunk using the actual embedding tokenizer, account for special tokens, and assert that no chunk is silently truncated. Re-index after changing chunk boundaries. Keep larger parent passages for display/generation if needed.

Evidence: [chunker.ts:11](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/document-processing/src/chunker.ts:11), [local.ts:19](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/embeddings/src/local.ts:19). The [model tokenizer configuration](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX/blob/main/tokenizer_config.json) and local cached configuration specify the limit.

### 4. P1 — A valid citation ID does not establish a grounded claim (reproduced validator limitation)

`validateCitations()` checks whether an ID exists, not whether the cited passage supports a claim. An isolated probe preserved “The moon is made of cheese [S1]” when S1 existed and referred to a database source. This does not mean Gemini produced that sentence; it demonstrates what the validator guarantees. An answer with one valid citation can retain other unsupported claims. The first-passage fallback also substitutes a passage whenever generation lacks citations, even if the model intended to refuse for insufficient evidence.

**Fix:** preserve explicit insufficient-evidence answers; require evidence for substantive claims; add groundedness evaluations and prompt-injection tests. Consider structured answer/claim-to-source output and selective verification. Display references as supporting passages, not as a guarantee of correctness.

Evidence: [citation-engine.ts:2](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/citation-engine.ts:2), [chat-service.ts:62](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/chat-service.ts:62), [prompt-builder.ts:5](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/prompt-builder.ts:5).

### 5. P2 — Context is cropped a second time without relevance selection (code finding)

The prompt includes only the first 1,800 characters of each selected chunk. The current corpus already contains chunks over that size. A relevant ending can rank the passage but never reach Gemini. Each page is flattened, so question, formula, and list boundaries are also lost.

**Fix:** use token-budgeted evidence windows around the match, preserve question/section boundaries, and explicitly record the excerpt supplied to the model. Avoid arbitrary character cropping.

Evidence: [context-builder.ts:10](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/context-builder.ts:10), [chunker.ts:17](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/document-processing/src/chunker.ts:17).

### 6. P2 — Intent rules and query rewriting change the question incorrectly (reproduced)

“Do not generate practice questions; explain schemas” routes to practice generation. “Explain SQL ON clauses” becomes “SQL clauses,” losing an actual SQL keyword. Count requests only distinguish PYQs from everything else: in an isolated database with zero tutorials, “How many tutorial files are there?” reported **2 indexed documents**.

**Fix:** use conservative intent rules that handle negation and supported resource types. Preserve technical tokens, quoted phrases, and operators. Ask for clarification when the intended resource type is ambiguous. Keep deterministic counts based on matching database filters.

Evidence: [query-router.ts:2](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/query-router.ts:2), [chat-service.ts:44](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/chat-service.ts:44).

### 7. P2 — PYQ search returns page references rather than useful question results (code finding)

The resource-search branch lists document title and page. It does not extract individual questions, deduplicate papers, expose year/marks/set, or support those filters. The new papers contain all of this information, but the catalog/database lacks normalized fields for it.

**Fix:** extract paper metadata and question boundaries during ingestion. Return matched question text with paper/year/page; group repeated hits from the same paper. This is an AI-side catalog/index improvement.

Evidence: [chat-service.ts:51](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/chat-service.ts:51), [schema.prisma:24](C:/Users/AYUSH/Documents/unicheatsheetAI/prisma/schema.prisma:24), [catalog-builder.ts:7](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/unicheatsheet-source/src/catalog-builder.ts:7).

### 8. P2 — History citations and course changes are not isolated per turn (code finding)

Every answer starts again at S1, while old assistant text containing S1 is passed back without its original source mapping. Switching course in an existing conversation retains old course discussion in the prompt. Even with valid authorization for both courses, this can confuse attribution and subject context.

**Fix:** retain structured per-turn evidence, label history citations as historical, and limit topic context when scope changes. Keep a visible course label per exchange or start a new course-scoped conversation.

Evidence: [conversation-memory.ts:16](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/conversation-memory.ts:16), [context-builder.ts:4](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/context-builder.ts:4), [prompt-builder.ts:6](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/prompt-builder.ts:6).

### 9. P2 — No representative quality evaluation or answer trace (coverage gap)

Existing chat tests use a mock provider. The follow-up test checks persistence, not whether the follow-up is answered. No measured retrieval recall, citation support, unsupported-answer rate, latency distribution, or model usage is stored. The new paper probes revealed errors the existing tests miss.

**Fix:** keep an evaluation set with expected document/page/question IDs, including these real exam questions and negatives. Record retrieval query, scores, selected chunk versions, provider/model, timings, and usage without logging credentials. Run quality checks when changing embeddings, chunking, prompts, or thresholds.

Evidence: [chat.integration.test.ts:7](C:/Users/AYUSH/Documents/unicheatsheetAI/tests/chat.integration.test.ts:7), [retrieval.integration.test.ts:14](C:/Users/AYUSH/Documents/unicheatsheetAI/tests/retrieval.integration.test.ts:14), [chat-service.ts:68](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/chat-service.ts:68).

## Document and Drive lifecycle

### 10. P1 — Primary cache sync never refreshes an intact file (code finding)

`pnpm sync:drive` checks the local size/hash against its own manifest and skips an intact file indefinitely. It does not inspect remote modification time/hash or apply `DRIVE_REFRESH_HOURS`. A changed or newly inaccessible Drive file can leave the old content served indefinitely.

**Fix:** add remote freshness/permission checks or a bounded refresh policy and an explicit force-refresh option, then re-index changed files. Mark withdrawn sources unavailable according to policy. Keep targeted ID downloads.

Evidence: [synchronizer.ts:18](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/synchronizer.ts:18), [synchronizer.ts:41](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/synchronizer.ts:41), [sync-drive.ts:14](C:/Users/AYUSH/Documents/unicheatsheetAI/scripts/sync-drive.ts:14).

### 11. P1 — Repeating a limited sync never advances past the first files (code finding)

Both sync implementations select `slice(0, limit)` before checking which files are already cached. With 10 files and a limit of 3, running the command repeatedly keeps checking the same first three. It does not process the next batch.

**Fix:** select pending/stale items before applying the work limit, or add a persisted cursor. Report total eligible, remaining, skipped, refreshed, and failed counts.

Evidence: [synchronizer.ts:34](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/synchronizer.ts:34), [id-source.ts:81](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/id-source.ts:81).

### 12. P1 — Source removal is not handled by the documented primary pipeline (code finding)

Cache sync plus `index:file` never reconciles removed catalog entries with the database. Removed documents can remain active and searchable. The older `drive:sync` does deactivate missing IDs, but it receives only resolved resources and assumes that list is complete. A partially scanned or unresolved catalog can consequently deactivate valid documents.

**Fix:** introduce a complete-catalog reconciliation stage with validation and change review. Only deactivate after a successful authoritative scan. Distinguish missing, unresolved, inaccessible, and intentionally withdrawn resources.

Evidence: [index-document.ts:22](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/indexing/src/index-document.ts:22), [drive-sync.ts:11](C:/Users/AYUSH/Documents/unicheatsheetAI/scripts/drive-sync.ts:11), [id-source.ts:80](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/id-source.ts:80).

### 13. P1 — Re-indexing breaks existing citation links (reproduced)

Re-indexing deletes every old chunk and inserts random new IDs. Saved messages retain the deleted chunk IDs. A probe changed the chunk setting and confirmed that the previous citation ID no longer resolved.

**Fix:** version indexed documents and preserve cited versions, or provide stable citation resolution using document version/page/offset with an explicit archived-source policy. Do not silently make old citations point to newly changed text.

Evidence: [index.ts:59](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ingestion/src/index.ts:59), [index.ts:63](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ingestion/src/index.ts:63), [SourceDrawer.tsx:13](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/SourceDrawer.tsx:13).

### 14. P2 — Two sync implementations have different behavior and settings (code finding)

`sync:drive` and `drive:sync` have different refresh, manifest, type, indexing, and lifecycle behavior. The older command hardcodes its manifest path. Its unchanged-content branch updates title/type/URL but does not move the document/chunks when a course mapping changes, leaving retrieval attached to the old course.

**Fix:** converge on one staged pipeline with one manifest contract and a single course-remapping path. Retain compatibility aliases for commands. This avoids asking the main website to accommodate two ingestion contracts.

Evidence: [drive-sync.ts:18](C:/Users/AYUSH/Documents/unicheatsheetAI/scripts/drive-sync.ts:18), [id-source.ts:106](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/drive-sync/src/id-source.ts:106), [index-document.ts:30](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/indexing/src/index-document.ts:30).

### 15. P2 — Folder URLs are intentionally ignored (confirmed with supplied inputs)

`extractDriveFileId()` returns null for any URL containing `folders`. None of the three new folder links can feed the scanner directly. Manual enumeration worked, proving an AI-side adapter can solve this.

**Fix:** support an explicit allowlist of folder IDs and recursively enumerate only those folders, with deduplication, file-type/size limits, and reviewed course/program mapping. Preserve direct-file support. No main website URL changes are needed.

Evidence: [drive-url.ts:7](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/unicheatsheet-source/src/drive-url.ts:7).

### 16. P2 — Course and document identity assumptions do not fit shared resources (code finding)

The scanner deduplicates by Drive ID before course resolution, retaining only the first occurrence. The database associates a source/document with one course. A paper reused under multiple courses, or a folder mixing B.Sc. I and B.Tech II as supplied here, cannot safely be assigned from the folder alone.

**Fix:** keep all source-to-course associations for review; map to existing main-site course IDs in an AI-side adapter. Add internal program/exam metadata where needed. This does not require changing the main website's entitlement model.

Evidence: [scanner.ts:40](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/unicheatsheet-source/src/scanner.ts:40), [schema.prisma:24](C:/Users/AYUSH/Documents/unicheatsheetAI/prisma/schema.prisma:24), [schema.prisma:99](C:/Users/AYUSH/Documents/unicheatsheetAI/prisma/schema.prisma:99).

### 17. P1 for the supplied scanned paper — OCR and extraction quality are incomplete (reproduced)

The 2024 Digital Electronics paper yields no text on either page and cannot be indexed. The parser checks only total document characters, so partly scanned documents can appear successfully processed even when some pages contribute nothing. Physics equations showed broken exponents/subscripts and mixed glyphs in extracted output; replacing line breaks with spaces cannot restore their meaning.

**Fix:** add per-page quality flags and OCR for pages requiring it. Distinguish a blank page from an image-only page. Add layout/math-aware extraction or retain rendered page references for verification. Keep the current text-PDF fast path.

Evidence: [parser.ts:22](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/document-processing/src/parser.ts:22), [pdf.ts:20](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/document-processing/src/pdf.ts:20), [chunker.ts:19](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/document-processing/src/chunker.ts:19).

### 18. P2 — Failed updates take a previously good document out of search (code finding)

Ingestion changes the active document to parsing before the replacement is ready. A parse/embedding failure leaves it failed, even though old chunks still exist. The skip key also has no parser-version component, so parser improvements alone do not trigger reprocessing.

**Fix:** stage a new document version and publish atomically after extraction/embedding succeeds. Track content hash, parser version, chunker version, and embedding revision independently. Serialize ingestion per document.

Evidence: [index.ts:43](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ingestion/src/index.ts:43), [index.ts:69](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ingestion/src/index.ts:69), [index.ts:19](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ingestion/src/index.ts:19).

## API, security, and operations

### 19. P1 before public access — No resource-use controls (code finding)

Authentication restricts who can call the service, but does not limit calls. There is no per-user rate limit, concurrent-generation cap, model-output cap, or explicit end-to-end timeout. A stalled provider can keep the UI waiting, and an authorized account can consume unbounded model/CPU resources.

**Fix:** enforce per-subject limits, bounded concurrency, request deadlines, output budgets, and explicit 429/503 responses on the AI server. These require no website redesign.

Evidence: [app.ts:12](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:12), [gemini.ts:14](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/providers/llm/src/gemini.ts:14), [ollama.ts:7](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/providers/llm/src/ollama.ts:7).

### 20. P2 — Cancellation and stream failures are incomplete (code finding)

The frontend, proxy, chat service, and provider do not propagate one cancellation signal. The API checks a destroyed response only after receiving the next event. Provider finish reasons/blocked responses are not handled, and a stream with no content can end in the first-passage fallback. Raw provider/internal exception messages are sent in SSE error events. Backpressure and stream heartbeat behavior are also unimplemented.

**Fix:** carry AbortSignal end to end, cancel on disconnect/Stop, bound idle time, inspect provider finish/error state, and return stable user-safe error codes. Preserve partial output as interrupted rather than presenting it as complete.

Evidence: [[apps/playground/src/app/api/ai/[...path]/route.ts:17]], [app.ts:90](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:90), [app.ts:96](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:96), [gemini.ts:28](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/providers/llm/src/gemini.ts:28).

### 21. P2 — Pending/failed documents can be read through the document route (reproduced)

The document endpoint lacks the `processingStatus: indexed` constraint used by chunk retrieval. A request for the existing pending DBMS duplicate returned HTTP 200 with **97 chunks**. This is inconsistent publication state, although the course authorization still applies.

**Fix:** apply the same document visibility/version/lifecycle predicate to every retrieval and detail route.

Evidence: [app.ts:99](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:99).

### 22. P1 before deployment — Development database is exposed on all host interfaces (confirmed configuration)

Docker currently publishes PostgreSQL at `0.0.0.0:5432` and uses the repository's `ucs/ucs` credentials. Network/firewall reachability was not tested, so internet exposure is not claimed.

**Fix:** bind local development PostgreSQL to loopback, use private networking in production, provision unique credentials, and test backups/restoration. All changes belong to the AI deployment.

Evidence: [docker-compose.yml:4](C:/Users/AYUSH/Documents/unicheatsheetAI/docker-compose.yml:4).

### 23. P2 — Dependency advisories need remediation and reachability review

The audit reports four high entries involving `pdfjs-dist`, `deepmerge-ts`, and two `sharp` advisories, plus two moderate entries for Vitest/mocker. The [PDF.js advisory](https://github.com/advisories/GHSA-hq66-cqwq-w95j) concerns scripting in a hosting-domain viewer; this app uses server text extraction, so the reported version alone does not establish exploitable server execution. The same distinction applies to image-processing dependencies unused by text embeddings and test-only tooling.

**Fix:** upgrade supported dependencies with parser/embedding regression checks and document remaining reachability. Do not treat every audit entry as a demonstrated remote vulnerability.

Other audit references: [sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

### 24. P2 — Configuration and deployment instructions overstate portability (confirmed)

`EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` are advertised but the model and 384 dimensions are hardcoded. `DRIVE_REFRESH_HOURS` is not used by cache-only sync. Rclone was not on PATH in the review shell; only the configured absolute executable path worked. There is no API production `start` script, workspace exports reference TypeScript source, and readiness endpoints always return OK without checking PostgreSQL/model readiness. The integration guide's generic “run the API process” step is therefore incomplete.

**Fix:** validate all settings at startup; remove or implement ineffective settings; add a tested production start/build strategy and readiness checks. Use the configured rclone binary in diagnostic commands, and document the service account/config location on the other PC.

Evidence: [local.ts:6](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/embeddings/src/local.ts:6), [package.json:5](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/package.json:5), [package.json:1](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/providers/package.json:1), [app.ts:32](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:32), [.env.example:12](C:/Users/AYUSH/Documents/unicheatsheetAI/.env.example:12).

### 25. P2 — Local secret-file ignore pattern is incomplete (reproduced)

`git check-ignore` ignores `.env.production.local` but not `apps/playground/.env.local`. The guide recommends that exact filename. It currently needs an API URL, but future auth/bootstrap configuration could accidentally be committed.

**Fix:** explicitly ignore `.env.local` at every depth and keep only redacted examples tracked. This review did not find or expose a secret in that file.

Evidence: [.gitignore:5](C:/Users/AYUSH/Documents/unicheatsheetAI/.gitignore:5).

### 26. P2 — History and concurrent requests need database-level limits (code finding)

The list route fetches all of a user's conversations, filters in memory, then slices to 50. A conversation detail loads all messages. Concurrent requests can read the same old history and overwrite scope-union updates; the client-only busy flag does not protect two tabs or direct API calls. All-course history also records every granted course, not only courses actually used, so losing an unrelated grant can hide otherwise relevant conversations.

**Fix:** paginate in the database, serialize turns or use optimistic versions, update scope unions atomically, and distinguish granted scope from actually used sources. Preserve conservative authorization while adding a precise access policy.

Evidence: [app.ts:49](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:49), [app.ts:58](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/api/src/app.ts:58), [conversation-memory.ts:6](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/ai-core/src/conversation-memory.ts:6).

### 27. P2 — Integration tests can alter the normal prototype database (code finding)

Tests load root `.env` and use fixed document IDs that also exist in the playground. The sample test deletes its fixed ID; another test ingests the supplied DBMS PDF under its normal ID. Running the suite against the default database can change normal data and citation targets.

**Fix:** require a separate test database name/URL, enforce a test-database guard, and use run-specific IDs. This audit used an isolated database for that reason.

Evidence: [retrieval.integration.test.ts:1](C:/Users/AYUSH/Documents/unicheatsheetAI/tests/retrieval.integration.test.ts:1), [retrieval.integration.test.ts:47](C:/Users/AYUSH/Documents/unicheatsheetAI/tests/retrieval.integration.test.ts:47), [vitest.integration.config.ts:3](C:/Users/AYUSH/Documents/unicheatsheetAI/vitest.integration.config.ts:3).

## UI and UX

### 28. P2 — Home history control does nothing (reproduced)

The header shows the history button when history exists, but Workspace mounts the sidebar only for a conversation. Clicking the button on the landing page changes state with no visible result.

**Fix:** mount the history surface when open on either page; hide its resting desktop layout only where appropriate.

Evidence: [Workspace.tsx:20](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/Workspace.tsx:20), [Header.tsx:12](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/navigation/Header.tsx:12).

### 29. P1 — An old stream can take over a new/navigation state (reproduced)

New chat clears state without aborting the existing request. Its later events can update status/conversation and call `router.replace()`. In the browser check, starting another answer and clicking Home ultimately returned to the old chat. Conversation loads likewise have no request-generation guard, so rapid navigation can apply stale data.

**Fix:** cancel requests on navigation, associate callbacks with the active conversation/request ID, and ignore stale completions. Apply the same guard to context/history loads.

Evidence: [useChatWorkspace.tsx:41](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/hooks/useChatWorkspace.tsx:41), [useChatWorkspace.tsx:51](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/hooks/useChatWorkspace.tsx:51), [useChatWorkspace.tsx:72](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/hooks/useChatWorkspace.tsx:72).

### 30. P2 — Startup errors and message failures are hard to recover from (code finding)

Context-loading failures set an error, but errors are rendered only in the conversation branch. The landing page can silently show an empty course list. The composer clears text before submission, has no retry/Stop control, and accepts a one-character or over-4,000-character message that the API rejects. Errors are rendered as assistant content and again as an alert.

**Fix:** explicit loading/offline/access-denied states on both screens; preserve failed drafts; expose Retry and Stop; mirror request length limits; keep operational errors separate from assistant answers.

Evidence: [Workspace.tsx:26](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/Workspace.tsx:26), [useChatWorkspace.tsx:37](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/hooks/useChatWorkspace.tsx:37), [ChatComposer.tsx:12](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/ChatComposer.tsx:12), [index.ts:18](C:/Users/AYUSH/Documents/unicheatsheetAI/packages/shared/src/index.ts:18).

### 31. P2 — Starter prompts do not match available material (confirmed)

All three prompt buttons hardcode normalization, including while Physics or EVS is selected. The current normal database returned no normalization or functional-dependency hits, and it had no PYQ documents before the separate review import. The UI promises past-paper grounding without showing corpus coverage. “Connected to your indexed material” is static text rather than health status.

**Fix:** generate suggestions from indexed course/topic availability; show “no papers indexed yet” where relevant; expose document counts and last successful index time. Use honest connection/readiness state.

Evidence: [WelcomeScreen.tsx:9](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/WelcomeScreen.tsx:9), [ChatSidebar.tsx:22](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/navigation/ChatSidebar.tsx:22).

### 32. P2 — Modal and mobile navigation keyboard behavior is incomplete (partly reproduced)

The source dialog declares `aria-modal` but does not move focus into it or trap/restore focus. The browser check showed focus remained behind it. The off-screen mobile sidebar is translated with CSS without being inert/hidden to keyboard navigation. The transparent native course selector's focus ring is also difficult to see.

**Fix:** use a tested dialog primitive or implement focus entry/trap/restore and inert background content. Hide closed mobile navigation from tab order and expose a visible focus state on the selector wrapper.

Evidence: [SourceDrawer.tsx:20](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/SourceDrawer.tsx:20), [ChatSidebar.tsx:12](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/navigation/ChatSidebar.tsx:12), [globals.css:9](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/app/globals.css:9).

### 33. P2 — Reading, contrast, and academic formatting need refinement (code/visual finding)

Every message/token change triggers smooth scrolling to the bottom, preventing a student from comfortably reading earlier content during generation. Small text at 22–28% white on black has poor contrast. The page renders GFM Markdown but no mathematical typesetting; the new Physics corpus needs readable equations. Long tables have no dedicated responsive wrapper.

**Fix:** autoscroll only when near the bottom; otherwise show a new-content button. Improve text contrast/size, respect reduced motion in imperative scrolling, add safe math rendering after extraction quality is addressed, and make wide tables/code usable on mobile.

Evidence: [Workspace.tsx:16](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/Workspace.tsx:16), [ChatMessage.tsx:2](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/components/ai/ChatMessage.tsx:2), [globals.css:10](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/app/globals.css:10).

### 34. P2 before public integration — Playground has no token lifecycle (known planned gap)

The proxy can forward Authorization, but the client never acquires or sends a JWT, refreshes it, or clears user state when identity changes. It works in local dev mode. Exposing the same frontend against JWT mode will produce unauthorized requests until the planned token integration exists.

**Fix:** keep this in the AI frontend as a configurable token-provider adapter, plus the small main-site issuance endpoint already described in the guide. Preserve existing JWT claims and API routes.

Evidence: [ai-client.ts:5](C:/Users/AYUSH/Documents/unicheatsheetAI/apps/playground/src/lib/api/ai-client.ts:5), [[apps/playground/src/app/api/ai/[...path]/route.ts:16]].

## Improvements after the correctness work

These are worthwhile opportunities rather than all being present failures:

- **RAG:** candidate deduplication/diversity, neighboring question context, year/type filters, explicit source coverage, multilingual query evaluation, and carefully keyed retrieval caching.
- **Study workflow:** copy answer/code, edit and retry a question, rename/delete/export conversations, visible course per exchange, source search highlighting, and a page preview with equation/diagram access.
- **Accessibility:** screen-reader testing of answer completion, keyboard-only mobile navigation, enlarged touch targets, zoom at 200%, and real-device virtual keyboard checks.
- **Operations:** ingestion job progress/retry controls, a protected admin status page, source freshness metrics, model usage/cost tracking, backup restore drills, retention rules, and graceful shutdown.
- **Scale:** benchmark exact pgvector search first; introduce an ANN index when measured corpus/latency warrants it. Add pagination and bounded workers before adding infrastructure.
- **Maintenance:** consolidate duplicated types/providers, expand dense one-line source for readability, pin/test model revisions, and add CI for the existing tests plus browser regressions.

## What can stay unchanged in UniCheatSheet.com

Almost all findings above can be corrected inside this repository and its AI server deployment: follow-up retrieval, hybrid ranking, chunking, OCR, folder enumeration, sync reconciliation, citation versions, rate limiting, stream handling, UI bugs, and tests.

Keep the guide's existing small integration surface:

1. The website derives user/course access through its existing rules and issues the agreed short-lived JWT.
2. An “Ask AI” entry point opens the AI interface with an optional course selection.
3. The AI side maps existing course/resource IDs through an adapter.
4. Original-resource links reuse an existing authorized website route where available; only add a small resolver if the site has none.

Do not require the main site to host embeddings, expose its database, move payment logic, redesign course pages, or rewrite existing Drive links. Folder expansion and aliases can live on the AI server. If the real production site has no authenticated backend, the guide's token issuer remains a genuine prerequisite; this review cannot verify that remote system.

## Suggested implementation order

| Stage | Work | Completion evidence | Main-site impact |
| --- | --- | --- | --- |
| 1 — Reliable local experience | Fix follow-up retrieval, history button, stale stream/navigation handling, errors and draft recovery. | Browser regressions plus meaningful follow-up assertions. | None |
| 2 — Reliable corpus | Add approved-folder adapter, reviewed mappings, per-page OCR/quality, advancing batches, refresh/removal reconciliation, citation versioning. | All 10 supplied PDFs processed or explicitly flagged; changed/removed source tests pass. | None; consume existing IDs |
| 3 — Better answers | Token-aware question chunks, hybrid ranking, relevance windows, question-level PYQ results, groundedness evaluation. | Flynn taxonomy/Hall coefficient found; negatives still rejected; claim/source checks. | None |
| 4 — Shared pilot readiness | Rate/concurrency limits, cancellation/deadlines, dependency maintenance, private DB, production runtime/readiness, isolated CI database. | Controlled failure/load tests, deploy/restore check, reviewed audit. | None |
| 5 — Planned connection | Token-provider adapter, existing JWT issuer contract, course entry point, authorized citation links. | Two-user end-to-end entitlement and expiry tests. | Small integration already planned |

This is a bounded review, not a guarantee that every defect has been found. Production performance, hostile PDF behavior, all model responses, and the separate main website require further testing in their actual environments.

