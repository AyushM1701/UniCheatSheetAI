# UniCheatSheet AI — Deep Source Audit & Full Implementation Plan

**Audit basis:** Continuously updated from live source (current snapshot: 29 September 2026)
**Scope:** runtime code, API/auth, RAG/retrieval, database schema/migrations, ingestion, OCR, Drive sync, Next.js UI, tests, deployment configuration, catalogs, and project documentation.
**Objective:** Identify current defects and technical debt, distinguish already-implemented safeguards from still-missing work, and define the implementation sequence for product improvements.

---

## 0. Audit method and limits

The repository is reviewed at line level. Runtime code paths are manually inspected. This is a **live audit of the current codebase** and is updated as implementation progresses. Items marked ✅ are confirmed implemented and tested.

### Bottom-line assessment (updated 29 September 2026)

The repository has advanced significantly beyond an early prototype. It contains a coherent RAG stack, JWKS-capable JWT access context, HMAC-keyed account identity, scoped retrieval with RRF-style hybrid ranking, real LLM streaming with provenance labels, structured exam questions, conversation deletion, retention purge, and a dark/cyan Next.js 15 playground. However, it is **not yet production-ready for UniCheatSheet's paid student flow** because the real website is not connected, the production resource catalog is not authoritative, resource links are not protected end-to-end, and several RAG quality and UI gaps remain.

---

# 1. What is already implemented — confirmed in current code

| Item | Evidence |
|---|---|
| ✅ Access-context provider abstraction (dev + RS256 JWT) | `apps/api/src/access-context.ts` |
| ✅ **JWKS multi-key rotation support** | `access-context.ts`: `AI_JWT_JWKS_FILE` + `createLocalJWKSet` from `jose` |
| ✅ **HMAC-SHA-256 account key** (not plain SHA-256 of sub) | `app.ts`: `createHmac('sha256', accountSalt).update(userId)` |
| ✅ Server-side course scoping on all routes | all `/v1/*` routes enforce `allowedCourseIds` |
| ✅ Conversation ownership + grant checks | userId + course scope checks in conversation reads |
| ✅ **RRF-style hybrid retrieval ranking** | `retrieval/src/index.ts`: `1/(60+rank)` formula with lexical+semantic merge |
| ✅ Hybrid retrieval (pgvector cosine + FTS) | `retrieval/src/index.ts` |
| ✅ Embedding token-limit guard | MiniLM token check + `fitModelWindow()` |
| ✅ **Real incremental LLM streaming (true delta streaming)** | `chat-service.ts`: yields `delta` tokens from provider stream in real-time |
| ✅ **Provenance labels** (`grounded/mixed/general/insufficient`) | `chat-service.ts` + `types.ts`: `AnswerProvenance` type, computed per response |
| ✅ Citation identity validation | `citation-engine.ts`: model-produced IDs restricted to backend-assigned IDs |
| ✅ OCR fallback (Tesseract + optional TrOCR) | `document-processing/src/ocr.ts` + `scripts/ocr_page.py` |
| ✅ Source lifecycle (active/deactivated sources) | `SourceFile.active` + exclusion in retrieval |
| ✅ **Document revision tracking** | `AcademicDocument`: `revision`, `pendingChecksum`, `lastSuccessfulAt`, `lastFailureAt` |
| ✅ **`Resource` model in schema** | `prisma/schema.prisma`: `Resource` with `resourceType`, `contentFormat`, `unit`, `sourceAssetId` |
| ✅ **`ExamQuestion` model with structured metadata** | schema: `questionNumber`, `subpart`, `marks`, `examType`, `year`, `session`, `topicTags` |
| ✅ **`ResourceType` and `ContentFormat` enums** | schema: Prisma enums, not free strings |
| ✅ **`resourceAvailability` in context response** | `app.ts`: computed from DB and returned in `/v1/me/context` |
| ✅ **`/v1/resources` and `/v1/resources/:id` routes** | `app.ts` |
| ✅ **Conversation deletion (`DELETE /v1/conversations/:id`)** | `app.ts` |
| ✅ **Delete all conversations (`DELETE /v1/me/conversations`)** | `app.ts` |
| ✅ **Retention purge command** | `scripts/purge-old-conversations.ts` + `CONVERSATION_RETENTION_DAYS` |
| ✅ **SSE proxy hardening**: `X-Accel-Buffering: no` + keepalive heartbeat | `app.ts`: `x-accel-buffering: no` + 15s heartbeat interval |
| ✅ **Backpressure awareness** in SSE | `app.ts`: heartbeat checks `writableLength < 64KB` |
| ✅ Gemini retry/backoff on 429/500/502/503/504 | `providers/llm/src/gemini.ts` |
| ✅ `/v1/pyqs/questions` and `/v1/pyqs/repeated` endpoints | `app.ts` + `pyq-browser.ts` |
| ✅ **Structured PYQ extraction and backfill** | `scripts/backfill-exam-questions.ts` + `packages/ingestion/src/exam-metadata.ts` |
| ✅ **Catalog import script** | `scripts/import-resource-catalog.ts` |
| ✅ Dark/cyan UniCheatSheet-styled playground | Next.js 15, `globals.css`, full chat UI |
| ✅ Production-mode startup guard | requires `AI_PUBLIC_MODE` + `AI_CORS_ORIGINS` |
| ✅ **KaTeX math rendering** | `apps/playground/package.json` + `ChatMessage.tsx` |
| ✅ Resource catalog IDs with explicit `resourceId` in citations | `Citation` type includes `resourceId` |
| ✅ Typecheck passing (all packages) | confirmed `pnpm typecheck` → 0 errors |
| ✅ Tests passing: 26 tests, 7 test files | confirmed `pnpm test` |
| ✅ `INGESTION_PIPELINE_VERSION` environment variable | `.env.example` |

---

# 2. Priority legend

| Priority | Meaning |
|---|---|
| **P0** | Launch/integration blocker; fix before connecting paid students. |
| **P1** | Correctness, security, grounding, reliability, or core-product gap; fix before public pilot. |
| **P2** | Important UX, maintainability, accessibility, corpus coverage, or performance work. |
| **P3** | Scale/polish/future expansion; safe to defer until the core product works. |

---

# 3. Remaining issues and required fixes

## 3.1 Production integration and entitlement boundary

### P0-01 — The real UniCheatSheet website is not connected ❌
**Current:** JWT verification exists and is fully functional. But production UniCheatSheet.com does not yet issue the token consumed by this repository. The system is still driven by `dev-context.json` locally.

**Fix:** implement a single server-only endpoint in the existing main website, e.g. `POST /api/ai/session`. It must read the website's existing authenticated session and existing paid-access/course visibility logic, derive the exact canonical course IDs already visible to that student, and sign those IDs into a short-lived RS256 JWT (≤15 min). The AI must never independently infer semester/specialization/payment access.

**Acceptance:** two students in the same semester but different specializations receive different course arrays; manually editing `courseId` in an AI request never expands access.

### P0-02 — Production course IDs are provisional ❌
**Current:** `catalog/courses.json` contains development/provisional IDs. The local context is a mixture of fixture courses.

**Fix:** establish a canonical `course_id` contract shared by: main-site course records, main-site resource records, JWT `courses[]`, AI `Course.id`, catalog entries, and indexed chunks. Display names and aliases remain mutable metadata and must never be security keys.

### P0-03 — No authoritative production resource catalog ❌
**Current:** the scanner expects direct Drive links inside HTML pages; the documented local checkout has `href="#"`. Temporary folder catalogs are being used for tests. `scripts/import-resource-catalog.ts` exists but hasn't been run against the canonical source.

**Fix:** export a protected/versioned resource catalog from the main site's real resource store. The import script already exists (`pnpm catalog:import`) — it needs the canonical input file. Required minimum fields:

```ts
Resource {
  id: string;                 // stable website resource ID
  courseId: string;
  semester: number;
  resourceType: 'lecture'|'pyq'|'solution'|'tutorial'|'assignment'|'book'|'syllabus'|'other';
  title: string;
  unit?: string;
  sourceAssetId: string;      // Drive file ID
  sourceProvider: 'google_drive';
  contentFormat: 'typed'|'handwritten'|'mixed'|'scan'|'unknown';
  active: boolean;
}
```

### P0-04 — Protected original-resource opening is not implemented ❌
**Current:** direct Drive URLs are removed in JWT mode. The `Citation` type has `resourceId` but the frontend "Open original" resolves to nothing in production because the main site protected route doesn't exist yet.

**Fix:** main site exposes a protected route such as `/resources/:resourceId/open` that re-checks the current website session and course grant, then serves/redirects to the resource. `resourceId` is already in citations — the main site route is the missing piece.

### P1-05 — Retrieval API does not fully support the metadata the product needs ⚠️ (Partial)
**Current:** retrieval filters for `courseId`, `resourceTypes`, basic metadata exist. Filters for `resourceId`, `documentId`, `unit`, `examType`, `year`, `questionNumber`, `marks`, `contentFormat`, and OCR review state are not all implemented.

**Fix:** expand the retrieve endpoint to accept these filters. The schema already has the columns.

---

## 3.2 API and security

### P1-06 — ✅ DONE: `accountKey` now uses HMAC-SHA-256
Confirmed: `createHmac('sha256', accountSalt).update(userId)` in `app.ts`.

### P1-07 — ✅ DONE: JWKS multi-key rotation supported
Confirmed: `AI_JWT_JWKS_FILE` + `createLocalJWKSet` in `access-context.ts`.

### P1-08 — Rate/concurrency limiting is process-local ⚠️ (Acceptable for now)
**Current:** process-local rate/concurrency maps. `AI_MAX_CONCURRENT_CHATS` is configurable. Acceptable for single-process Hostinger deployment.

**Fix when multi-instance:** use shared Redis/Upstash advisory counters. Document the per-process limitation explicitly in Hostinger handoff.

### P1-09 — Direct retrieval/document endpoints allow authorized bulk extraction ⚠️
`POST /v1/retrieve` returns full chunk text; `GET /v1/documents/:id` returns all chunks. This is not cross-course leakage but can enable paid-content scraping.

**Fix:** production UI endpoints should return bounded excerpts. Paginate document reads; consider making raw `/v1/retrieve` developer/admin-only. Add per-route limits and audit logging.

### P1-10 — ✅ DONE: SSE proxy hardening implemented
Confirmed: `x-accel-buffering: no` + 15-second keepalive heartbeat + backpressure check in `app.ts`.

### P2-11 — API proxy returns development-specific outage text ⚠️
`apps/playground/src/app/api/ai/[...path]/route.ts` may still return dev-specific failure messages on upstream error.

**Fix:** production-safe message ("AI service is temporarily unavailable") with a correlation ID; log the actual upstream error server-side only.

### P2-12 — Page-image URL coupling to playground proxy path ⚠️
The API emits `/api/ai/chunks/.../page-image`, which is a UI-host route, not an API-domain contract.

**Fix:** return `pageImageAvailable` or `previewResourceId`; let the UI construct requests through its configured API client. Production preview must be access-checked.

### P2-13 — ✅ DONE: Conversation retention and deletion
Confirmed: `DELETE /v1/conversations/:id`, `DELETE /v1/me/conversations`, `scripts/purge-old-conversations.ts`, `CONVERSATION_RETENTION_DAYS`.

---

## 3.3 Chat orchestration and streaming

### P0-14 — ✅ DONE: Real incremental LLM streaming
Confirmed: `chat-service.ts` yields actual `delta` text from the provider stream in real-time. Partial citation markers are buffered and flushed progressively. The `done` event contains the validated final answer and citations.

### P1-15 — Citation validation proves identity, not support ⚠️
A real `[S1]` can still be attached to an unsupported claim and pass.

**Fix:** move toward structured answer segments/claims with per-segment provenance. Run sentence/claim-level support checks for sourced segments. Document that citation identity ≠ entailment.

### P1-16 — ✅ DONE: Provenance labels implemented
Confirmed: `AnswerProvenance = 'grounded' | 'mixed' | 'general' | 'insufficient'` in `types.ts`, computed in `chat-service.ts`, returned in `ChatResult.metadata.provenance`.

**Remaining:** UI must visibly display the provenance badge ("Based on UniCheatSheet" vs "General explanation") — the data is available but UI labeling should be validated.

### P1-17 — Explicit product modes partially available ⚠️
`routeQuery()` infers PYQ search from wording. UI sends `resourceTypes` but not yet a fully explicit `mode` field.

**Fix:** let UI send explicit `mode: 'notes'|'pyqs'|'solutions'` in addition to `resourceTypes`. Retain natural-language routing as fallback.

### P1-18 — Document-level scope partial ⚠️
Chat scope has `courseId` and `resourceTypes`. `resourceId` and `documentId` scope exist in types but may not be fully enforced on all retrieval paths.

**Fix:** validate that requested document/resource belongs to an allowed course. Enable "Ask AI about this specific document."

### P1-19 — Context selection uses top-K without diversity ⚠️
Context builder takes top-6 hits without chunk diversity enforcement.

**Fix:** apply per-document cap; prefer distinct evidence pages; MMR or equivalent diversification; token-budget-aware selection.

### P2-20 — Conversation scope accumulation can over-lock history ⚠️
`conversation-memory.ts` unions all used course IDs into `allowedCourseIds`. A conversation that briefly used a now-revoked course may become hidden.

**Fix:** store per-message course IDs; compute visibility from currently valid authorized content only. Avoid silent scope union surprises.

### P2-21 — Long history has no summarization layer ⚠️
Older context simply disappears beyond the window. Acceptable for MVP.

---

## 3.4 Retrieval quality

### P1-22 — ✅ DONE: RRF-style hybrid ranking
Confirmed: `retrieval/src/index.ts` uses `1/(60+rank)` Reciprocal Rank Fusion scoring for both lexical and semantic candidates. Lexical candidates no longer have absolute priority over all semantic matches.

### P1-23 — One fixed similarity threshold for all query types ⚠️
`RETRIEVAL_MIN_SCORE=0.30` is global.

**Fix:** use labeled evaluations to calibrate by query class (PYQ exact match vs conceptual paraphrase). The threshold is configurable via env — needs per-type calibration.

### P1-24 — No near-duplicate diversification/reranking ⚠️
Top results can be overlapping chunks from one page/document.

**Fix:** candidate retrieval → RRF fusion → near-duplicate suppression → per-document cap → optional lightweight reranker.

### P1-25 — FTS weak for formulas, acronyms, code, and exact exam tokens ⚠️
`plainto_tsquery('english')` can lose important forms.

**Fix:** add normalized exact-token/phrase search and `pg_trgm` for names/abbreviations; preserve quoted phrases and operators.

### P2-27 — Retrieval permits unscoped internal calls ⚠️
`retrieve()` itself permits unscoped calls even though the API wrapper passes grants.

**Fix:** split into `retrieveAuthorized(context, request)` and `retrieveAdmin/internal`. Make unsafe unscoped retrieval difficult by construction.

### P2-28 — Retrieval smoke suite is too small ⚠️
6 retrieval cases in `evals/retrieval.json`.

**Fix:** expand to 100–300 labeled queries across: exact topic, acronym, paraphrase, PYQ, equation, OCR variant, negative, cross-course leakage, document-specific, multi-course.

---

## 3.5 Chunking and embeddings

### P1-29 — First-pass chunking is approximate ⚠️
`chunker.ts` flattens paragraphs and estimates tokens using character length.

**Fix:** chunk with the embedding tokenizer from the start; preserve structural units (heading+paragraph, list, question, table).

### P1-30 — Emergency token-window split has no overlap ⚠️
`fitModelWindow()` splits an oversized chunk into disjoint word windows.

**Fix:** tokenizer-aware sliding split with 10–15% overlap and parent-section metadata.

### P1-31 — Embedding dimensions hardcoded in multiple layers ⚠️
`384` and `512` appear in provider/ingestion/retrieval/schema.

**Fix:** expose `dimensions` and `maxInputTokens` from provider; record `embeddingModelId` explicitly on each document/chunk/index revision.

### P2-32 — Hostinger deployment footprint not benchmarked on Linux ⚠️
~745 MB Windows deploy artifact recorded. Linux footprint unknown.

**Fix:** create a production pruned bundle; benchmark Linux disk/RAM/cold start before Hostinger deployment.

---

## 3.6 PDF, handwriting, OCR and visual material

### P1-33 — OCR may perform duplicate Tesseract work ⚠️
Node runs Tesseract; if quality is weak, Python worker may run Tesseract again.

**Fix:** choose one orchestration layer. Recommended: Node renders pages → sends batch job to long-lived Python OCR worker; Python runs Tesseract once, then optional fallbacks.

### P1-34 — TrOCR/Paddle models loaded per page ⚠️
`scripts/ocr_page.py` constructs models inside page-level functions with new Python process per page. Model startup dominates ingestion.

**Fix:** persistent local worker or one document/batch invocation. Load model(s) once, process all requested pages, then exit/idle.

### P1-35–P1-37 — Handwriting line segmentation fragility; math/diagram OCR uncertainty; production page verification disabled ⚠️
These remain as-is for the prototype. OCR text is primarily a retrieval index; original page remains authority.

### P2-38–P2-41 — PDF layout reconstruction, OCR trigger, per-document coverage ⚠️
Deferred to Phase 7.

---

## 3.7 Ingestion and source lifecycle

### P1-42 — ✅ DONE: `INGESTION_PIPELINE_VERSION` added
Confirmed in `.env.example`.

**Remaining:** verify that all parser, OCR engine, chunker, embedding model, and DPI settings are captured in the pipeline key comprehensively.

### P1-43 — ✅ DONE: Failed replacement indexing has clear state
Confirmed: `revision`, `pendingChecksum`, `lastSuccessfulAt`, `lastFailureAt`, `lastFailureReason` fields on `AcademicDocument`. Old chunks remain active if re-indexing fails.

### P2-44 — Row-by-row chunk insert inefficiency ⚠️
**Fix:** batched multi-row inserts. Important when full semesters are reindexed.

### P2-45 — Duplicate Drive sync implementations ⚠️
Both `syncResources` and `RcloneIdSource` exist.

**Fix:** consolidate around one source adapter + one cache lifecycle. One manifest format.

### P2-46 — Scanner deduplicates by Drive ID, discarding subsequent logical references ⚠️
**Fix:** separate physical `SourceAsset` from logical `Resource`. Many logical resources may reference one asset (already partially modeled via `Resource.sourceAssetId`).

### P2-47 — Fixed manifest temp name can collide ⚠️
**Fix:** random/unique temp names and sync lock to prevent overlapping scheduler runs.

### P2-48 — Hard 25 MB PDF limit duplicated ⚠️
**Fix:** validate from env config; log rejected resources into ingestion status.

---

## 3.8 Database/data-model gaps

### P0-49 — ✅ DONE: First-class `Resource` entity added
Confirmed: `Resource` model in `prisma/schema.prisma` with `resourceType` (enum), `contentFormat` (enum), `unit`, `sortOrder`, `sourceAssetId`, `sourceProvider`, `academicDocumentId`.

### P1-50 — ✅ DONE: Critical fields use Prisma enums
Confirmed: `ResourceType` enum, `ContentFormat` enum in schema.

### P1-51 — ✅ DONE: Structured PYQ/ExamQuestion fields present
Confirmed: `ExamQuestion` model with `questionNumber`, `subpart`, `marks`, `examType`, `year`, `session`, `program`, `courseCode`, `topicTags`, `text`, `page`, `needsReview`.

**Remaining gap:** `ExamPaper`-level metadata (linking multiple questions to one physical paper) is not yet a separate model. Currently implicit through `documentId` on `ExamQuestion`.

### P1-52 — Private LMS schema partially modeled ⚠️
`ownerUserId` exists; retrieval hardcodes `visibility='global'`.

**Deferred:** LMS retrieval path (`global OR private AND owner_user_id=currentUser`) — explicitly deferred until Phase 9.

### P2-53 — No user feedback/retrieval telemetry schema ⚠️
**Fix:** add privacy-conscious `AiRequestMetric` fields: latency, provider status, retrieval count, no-hit reason. Never log raw paid content.

---

## 3.9 LLM provider reliability

### P1-54 — ✅ DONE: Gemini has retry/backoff on transient errors
Confirmed: `providers/llm/src/gemini.ts` retries on 429/500/502/503/504.

**Remaining:** circuit breaker for sustained overload; graceful degradation (allow source browsing/PYQ browsing when LLM is unavailable).

### P1-55 — Production answer quality not yet proven ⚠️
Live Gemini timeouts/503s were recorded during prototype testing. Answer quality on the real production corpus has not been evaluated.

**Fix:** run a human-evaluated grounded-answer set on the real production corpus before launch.

### P2-56 — Ollama provider correctness issues ⚠️
`generate()` can silently return empty string; streaming parser doesn't flush final NDJSON object if response ends without newline.

**Fix:** throw on empty generated answer; flush final buffer.

### P2-57 — Provider capabilities are implicit ⚠️
**Fix:** add provider metadata (model name, supportsStreaming, maxOutput, timeout). Log provider/model in metrics.

---

## 3.10 Frontend/UI issues

### P1-58 — UI doesn't fully implement UniCheatSheet resource mental model ⚠️
Welcome screen has improved with KaTeX and structured UI, but full Notes/PYQs/Solutions modes with "Your Courses" cards and "Browse Material" hierarchy are not yet built.

**Fix:** implement Section 4 product design (see below). Data is available — `/v1/resources`, `resourceAvailability`, structured PYQs.

### P1-59 — Autoscroll behavior during streaming ⚠️
`Workspace.tsx` scroll logic depends on `messages.length`, not growing streamed content height. With real streaming now working (P0-14 done), long streaming text can grow below the viewport.

**Fix:** `ResizeObserver` on the latest message; autoscroll while user hasn't manually scrolled up.

### P2-60 — Source cards show course ID slug ⚠️
**Fix:** use course display name, resource type, unit/exam metadata, and OCR badge.

### P2-61 — User avatar is hard-coded ⚠️
**Fix:** neutral user icon; never derive display identity from opaque `sub`.

### P2-62 — ✅ DONE: KaTeX math rendering added
Confirmed: `apps/playground/package.json` includes KaTeX dependencies; `ChatMessage.tsx` renders math.

### P2-63 — Sidebar accessibility incomplete ⚠️
Chat-history drawer doesn't trap/inert background or move focus into the drawer.

**Fix:** dialog semantics/focus management consistently.

### P2-64 — Some touch targets below 44px ⚠️
Composer add/send and some icon controls.

**Fix:** enlarge hit area/minimum interactive box.

### P2-65 — CSS legacy/overlapping rules ⚠️
**Fix:** split `globals.css` into tokens/base + landing + chat + components.

### P2-66 — No frontend component/E2E tests ⚠️
**Fix:** Playwright tests for landing, course selector, streaming, cancellation, source drawer, history, session refresh/401, mobile, cross-account reset.

### P2-67 — Context refresh unnecessarily broad ⚠️
Provider reloads academic context on pathname change and browser focus.

**Fix:** cache within token lifetime; refresh on session change/401/focus after minimum stale interval.

---

# 4. Product redesign required by the real UniCheatSheet experience

## 4.1 Core product principle

UniCheatSheet AI should be the intelligent interface to the resource structure students already know:

```text
Paid student access
    ↓
Allowed semester/specialization courses (decided by main site)
    ↓
Course → Notes / PYQs / Solutions
    ↓
Unit / paper / tutorial / resource
    ↓
Ask, browse, revise, analyse, cite
```

The AI never decides what the student bought. It only works inside the exact course set the main website signs.

## 4.2 Landing screen — Target design

Keep the current UniCheatSheet visual DNA: black/deep navy, `#00e5ff`, Inter/Montserrat, glassy low-contrast surfaces, subtle glow.

```text
UniCheatSheet AI
Semester 4
Study what's actually in your semester.

┌────────────────────────────────────────────┐
│ Ask about notes, PYQs or solutions...      │
│                                            │
│ All Courses                             ↑  │
└────────────────────────────────────────────┘

[ Notes ]   [ PYQs ]   [ Solutions ]

Your Courses
[ Cryptography ] [ FLAT ] [ OOAD ] [ Specialization Course ]

Quick actions
[ Quick Revision ] [ Repeated PYQs ] [ Mock Test ] [ Unit Summaries ]
```

No semester picker. No specialization picker. Those are facts from the main site's existing entitlement state.

## 4.3 Notes / PYQs / Solutions as first-class modes

Explicit UI filters (not regex guesses):
- **Notes:** `resourceTypes=['lecture','book','syllabus']`
- **PYQs:** `resourceTypes=['pyq']`, with exam metadata filters
- **Solutions:** `resourceTypes=['solution','tutorial','assignment']`

## 4.4–4.14 Remaining product design

See original audit sections 4.4–4.14 for: course-first home, browse-material hierarchy, "Ask AI" on every main-site resource, three academic scopes (document/course/all), resource-aware citation cards, handwritten material badges, exam-aware PYQ model, PYQ intelligence analytics, exam-preparation actions, source coverage display, and provenance labels.

---

# 5. Target data model (current status)

```text
Course
  └── Resource [✅ EXISTS]       # product identity shown by website
        ├── resourceType [✅ enum]
        ├── unit [✅]
        ├── contentFormat [✅ enum]
        ├── sourceAssetId [✅]
        └── AcademicDocument [✅] # parsed/indexed representation
              ├── DocumentChunk[] [✅] with embedding
              └── ExamQuestion[] [✅] with questionNumber, marks, examType
```

**Remaining gap:**
- `ExamPaper` as a distinct model linking multiple `ExamQuestion` records to one physical paper.
- `Topic`/tag relation (deferred — only after automatic tagging evaluation is good).

---

# 6. Target API contract (current status)

## Access/context — ✅ Implemented

`GET /v1/me/context` returns:
```json
{
  "semester": 4,
  "allowedCourses": [{"id":"cryptography","name":"Cryptography"}],
  "currentCourseId": "cryptography",
  "resourceAvailability": {
    "cryptography": ["lecture","pyq","solution"]
  },
  "accountKey": "hmac-derived-non-linkable-key"
}
```

## Resources — ✅ Routes Exist, canonical data pending

- `GET /v1/resources?courseId=&type=&unit=` ✅
- `GET /v1/resources/:id` ✅
- `POST /api/ai/session` on main website ❌ (not yet implemented)

## Chat — ✅ Core implemented, explicit mode pending

```json
POST /v1/chat/stream
{
  "message": "Explain cache mapping",
  "conversationId": null,
  "mode": "notes",           // ⚠️ partial: resourceTypes work; explicit mode enum pending
  "scope": {
    "courseId": "computer-architecture",
    "resourceId": "coa-unit-4"    // ⚠️ resourceId scope enforcement pending
  }
}
```

## PYQ analytics — ✅ Core implemented

- `GET /v1/pyqs/questions?courseId=&year=&examType=` ✅
- `GET /v1/pyqs/repeated?courseId=` ✅
- `GET /v1/pyqs/topics?courseId=` ❌ topic clustering not yet built

## Citations — ✅ resourceId present, main-site protected route pending

Returns `resourceId`, course name, resource type, unit/exam metadata, page, extraction/review state, excerpt. Frontend resolves "Open original" through main-site protected route ❌ (main site route not built).

---

# 7. Free-tier + Hostinger deployment architecture

```text
INGESTION PC (your RTX machine; runs when content changes)
Drive/rclone → PDF parser → OCR/TrOCR → chunk → embeddings → remote pgvector DB

HOSTINGER (small always-on runtime)
Fastify API + JWT verify + query embedding + retrieval + Gemini API client + SSE
                                      ↓
                              remote pgvector DB

MAIN UNICHEATSHEET HOST
existing login/payment/access → short-lived AI JWT + protected resource route
```

**Never deploy to Hostinger:** rclone, PDF cache, page images, Poppler/Tesseract/Python, local ingestion jobs, Ollama, sample corpus.

---

# 8. Implementation phases — current progress

## Phase 0 — Freeze and baseline ✅ COMPLETE
- Repository tagged with commit history.
- Typecheck: passes. Tests: 26/26 pass.
- `INGESTION_PIPELINE_VERSION` added.
- `LOCAL_READINESS.md` documents current prototype state.

## Phase 1 — Canonical production catalog + resource model ✅ DONE (AI side)
- `Resource` model + migrations added. ✅
- `ResourceType` and `ContentFormat` enums in schema. ✅
- `scripts/import-resource-catalog.ts` built. ✅
- `resourceId` stable IDs present in citations. ✅
- **Pending:** main website exports the canonical resource catalog and runs `pnpm catalog:import` against real data. ❌

## Phase 2 — Real main-site entitlement bridge ❌ IN PROGRESS (AI side ready)
- JWT verification with JWKS rotation. ✅
- HMAC account key. ✅
- `resourceAvailability` in context response. ✅
- **Pending:** main website `POST /api/ai/session` endpoint. ❌
- **Pending:** E2E tests: specialization differences, logout, expiry, revoked course, account switch. ❌

## Phase 3 — Protected citations/resource opening ⚠️ PARTIAL
- `resourceId` in AI citations. ✅
- KaTeX rendering in citation drawer. ✅
- **Pending:** main site protected `/resources/:resourceId/open` route. ❌
- **Pending:** citation drawer shows OCR review state and handwritten badges. ⚠️

## Phase 4 — RAG correctness + real streaming ✅ SUBSTANTIALLY COMPLETE
- Real incremental SSE streaming. ✅
- SSE heartbeat + proxy hardening. ✅
- Provenance model (`grounded/general/mixed/insufficient`). ✅
- RRF hybrid ranking + diversity scoring. ✅
- Gemini retry/backoff. ✅
- **Pending:** tokenizer-native structural chunking with overlap. ❌
- **Pending:** resource/document metadata filters in retrieval. ⚠️
- **Pending:** claim-support evaluation. ❌
- **Pending:** larger retrieval eval suite (>100 queries). ❌
- **Pending:** Ollama final-buffer/empty-answer fix. ⚠️

## Phase 5 — UniCheatSheet-native AI product UI ❌ PENDING
- Notes/PYQs/Solutions mode tabs. ❌
- "Your Courses" cards on landing. ❌
- Browse Material hierarchy. ❌
- Provenance badges visible in UI. ⚠️ (data available, UI display not confirmed)
- True-stream autoscroll (`ResizeObserver`). ❌
- Accessibility/touch/focus cleanup. ❌

## Phase 6 — PYQ intelligence ✅ SUBSTANTIALLY COMPLETE
- Structured exam-paper/question extraction. ✅
- `ExamQuestion` records with marks, units, examType, year. ✅
- `/v1/pyqs/questions` and `/v1/pyqs/repeated`. ✅
- `pnpm pyq:backfill`. ✅
- **Pending:** topic tagging pipeline with confidence/review. ❌
- **Pending:** `/v1/pyqs/topics` endpoint. ❌
- **Pending:** generated practice clearly separated from real PYQs in UI. ⚠️

## Phase 7 — Handwriting/OCR productionization ⚠️ PARTIAL
- OCR + TrOCR Python fallback. ✅
- Single-pass Tesseract (text + confidence). ✅
- Per-page `needsReview` flag. ✅
- **Pending:** persistent/batch Python OCR worker (no per-page startup). ❌
- **Pending:** deskew/orientation/illumination preprocessing. ❌
- **Pending:** quality/review dashboard for admins. ❌

## Phase 8 — Hostinger/free-tier release hardening ❌ PENDING
- Linux production bundle size/RAM benchmark. ❌
- External pgvector DB migration/backup/restore test. ❌
- Concurrency/load test. ❌
- Structured logging/correlation IDs. ❌
- Route-specific rate limits. ❌
- Staging rollout → small student cohort → wider release. ❌

## Phase 9 — LMS connector ❌ Deferred
Only after Phase 8 and UniCheatSheet corpus works reliably.

---

# 9. Test plan — status

## Access/security
- [x] JWT verification tests (valid, expired, wrong iss/aud) — `tests/access-context.integration.test.ts`
- [x] Course scope isolation tests — integration tests
- [ ] Two students, same semester, different specializations
- [ ] Revoked course within token TTL and after refresh
- [ ] Account switch in same browser tab
- [ ] Protected resource URL after revocation
- [ ] Scraping/pagination/rate-limit behavior

## Retrieval
- [x] Basic semantic retrieval — `tests/retrieval.integration.test.ts`
- [x] Hybrid retrieval — integration tests
- [ ] Acronyms/course codes
- [ ] Formula-adjacent text
- [ ] OCR typo variants
- [ ] Cross-course leakage
- [ ] Duplicate chunks/diversity

## RAG/grounding
- [x] Citation identity validation — `tests/chat.test.ts`
- [x] Insufficient material fallback — `tests/chat.test.ts`
- [ ] Claim cited by wrong real source
- [ ] Prompt injection inside PDF
- [ ] General explanation correctly labeled (provenance badge)
- [ ] Real PYQ vs generated practice

## UI/E2E
- [ ] All Playwright tests (none yet)

## Ingestion
- [x] Typed PDF — `tests/document-processing.test.ts`
- [x] Exam question extraction — `tests/exam-metadata.test.ts`
- [x] Failed replacement preserving last-good revision — integration test
- [ ] Scanned print / handwriting
- [ ] Rotated/perspective page
- [ ] Duplicate Drive asset used by two resources

---

# 10. Definition of production-ready

The system is ready for a real student pilot only when ALL are true:

| Criterion | Status |
|---|---|
| Main site, not AI, determines exact course grants | ❌ Pending website work |
| Production canonical course/resource IDs shared by website and AI | ❌ Pending |
| Full intended production catalog indexed and coverage measurable | ❌ Pending |
| No direct raw Drive link as paid authorization boundary | ✅ Removed in JWT mode |
| Every protected AI route enforces signed allowed courses | ✅ |
| This-document/course/all-course scopes cannot cross grants | ⚠️ Partial |
| Real streaming through production proxy/Hostinger | ✅ |
| Grounded vs general knowledge visibly distinguished | ⚠️ Data ready, UI pending |
| PYQ results are actual indexed questions; practice is explicitly labeled | ✅ |
| Handwritten/OCR sources flagged; original can be checked | ⚠️ Flag exists; protected open route pending |
| Retrieval/grounding evaluation materially larger than smoke tests | ❌ Pending |
| Provider failures degrade gracefully | ⚠️ Retry exists; full circuit breaker pending |
| Hostinger Linux package + MiniLM fits 1.1 GB quota (measured) | ❌ Not yet measured |
| DB backup/restore tested | ❌ |
| Conversation retention/deletion policy exists | ✅ |
| Mobile/keyboard/screen-reader flows pass | ❌ |

---

# 11. Recommended immediate next 10 coding tasks

1. ❌ **[P0-01]** Main website `POST /api/ai/session` endpoint — signs RS256 JWT from existing login/payment/course state.
2. ❌ **[P0-02/03]** Import canonical course/resource catalog from the real UniCheatSheet resource store.
3. ❌ **[P0-04]** Main site protected resource opening route `/resources/:resourceId/open`.
4. ❌ **[P1-58]** Notes/PYQs/Solutions mode tabs + "Your Courses" landing UI cards.
5. ❌ **[P1-58]** Browse Material hierarchy UI (`/v1/resources` is ready).
6. ❌ **[P1-59]** True-stream autoscroll with `ResizeObserver`.
7. ⚠️ **[P1-16]** UI provenance badges ("Based on UniCheatSheet" / "General explanation").
8. ❌ **[P1-29/30]** Tokenizer-native structural chunking with sliding overlap.
9. ❌ **[P2-28]** Expand retrieval eval dataset to ≥100 labeled queries.
10. ❌ **[P7]** Persistent/batch Python OCR worker (no per-page model startup).

---

# 12. File-by-file change map (runtime files) — current status

| File/area | Status | Action remaining |
|---|---|---|
| `apps/api/src/access-context.ts` | ✅ JWKS, HMAC | — |
| `apps/api/src/app.ts` | ✅ SSE hardening, HMAC accountKey, resource routes, conversation delete | Add paginated document excerpts; per-route limits |
| `apps/api/src/server.ts` | ✅ | — |
| `apps/playground/.../route.ts` | ⚠️ | Production outage text still dev-specific |
| `useChatWorkspace.tsx` | ⚠️ | Add explicit mode/resource scope; autoscroll ResizeObserver |
| `WelcomeScreen.tsx` | ⚠️ | Notes/PYQs/Solutions tabs, Your Courses cards, quick actions |
| `ChatMessage.tsx` | ✅ KaTeX | Add provenance badge display |
| `SourceCard.tsx` | ⚠️ | Course display name, OCR badge |
| `SourceDrawer.tsx` | ⚠️ | Protected original, richer exam metadata |
| `ChatSidebar.tsx` | ⚠️ | Focus/inert accessibility |
| `globals.css` | ⚠️ | Split/refactor; touch targets |
| `packages/ai-core/chat-service.ts` | ✅ real stream, provenance | Explicit modes, diversified context |
| `citation-engine.ts` | ⚠️ | Claim-level support checks |
| `context-builder.ts` | ⚠️ | Token budget, per-doc diversity cap |
| `conversation-memory.ts` | ⚠️ | Explicit scope semantics |
| `query-router.ts` | ⚠️ | UI sends explicit mode; natural-language as fallback only |
| `pyq-browser.ts` | ✅ | Topics endpoint pending |
| `packages/retrieval/index.ts` | ✅ RRF | Diversity/near-dup suppression; `retrieveAuthorized` split |
| `document-processing/chunker.ts` | ❌ | Tokenizer-aware structural chunks with overlap |
| `document-processing/ocr.ts` | ⚠️ | Remove duplicate Tesseract; batch worker interface |
| `scripts/ocr_page.py` | ⚠️ | Persistent/batch model load; deskew/orientation |
| `ingestion/src/index.ts` | ✅ revision model | Batch inserts; comprehensive pipeline key |
| `prisma/schema.prisma` | ✅ Resource, ExamQuestion, enums | ExamPaper linking model; feedback schema |
