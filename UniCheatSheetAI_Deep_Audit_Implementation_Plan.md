# UniCheatSheet AI — Deep Source Audit & Full Implementation Plan

**Audit basis:** uploaded `architecture_and_souce.md` source archive (current snapshot)  
**Scope:** runtime code, API/auth, RAG/retrieval, database schema/migrations, ingestion, OCR, Drive sync, Next.js UI, tests, deployment configuration, catalogs, and project documentation.  
**Objective:** identify current defects and technical debt, distinguish already-implemented safeguards from still-missing work, and define the implementation sequence for the product improvements discussed after **“What the current UniCheatSheet experience tells us”**.

---

## 0. Audit method and limits

The archive was parsed into its tracked files and reviewed at line level. Runtime code paths were manually inspected; the remaining configuration, tests, catalogs, migration SQL, documentation, and lockfile were swept programmatically and cross-checked against their declarations. The repository snapshot contains 162 extractable text/config files; the generated archive also references binary/sample items that are not semantically auditable as source code. The lockfile was reviewed as dependency state rather than pretending that thousands of generated resolution lines are application logic.

This is a **static/source audit of the uploaded snapshot**. I did not rerun the repository's test suite against its original local database/Gemini credentials because those runtime dependencies are not part of the uploaded source archive. Where this repository's own audit document says tests passed, this plan treats that as a recorded project result rather than a fresh independent execution.

### Bottom-line assessment

The repository is no longer a toy prototype. It already contains a coherent RAG stack, JWT access-context abstraction, scoped retrieval, OCR fallback, citations, conversation persistence, Drive ingestion and a usable dark/cyan playground. However, it is **not production-ready for UniCheatSheet's paid student flow** because the real website is not connected, the production resource catalog is not authoritative, resource links are not protected end-to-end, the apparent streaming path buffers the complete LLM answer before emitting answer text, provenance is not represented strongly enough, and the data/UI model is still “generic chat over chunks” rather than “AI interface to Notes → PYQs → Solutions → Course → Unit/Exam”.

---

# 1. What is already implemented — do not rebuild it

These areas are present and should be **extended**, not rewritten from scratch:

1. **Access-context provider abstraction.** `apps/api/src/access-context.ts` supports a development context and an RS256 JWT provider. The JWT path verifies signature, issuer, audience, lifetime, unknown course IDs, and `currentCourseId` membership.
2. **Server-side course scoping.** `/v1/retrieve`, `/v1/chat`, source reads and conversation reads use the server-derived allowed course set. Browser course selection is not treated as a grant.
3. **Conversation ownership and grant checks.** Conversations are keyed to `userId` and hidden when their stored course scope is no longer a subset of current grants.
4. **Hybrid retrieval baseline.** `packages/retrieval/src/index.ts` runs vector search and PostgreSQL full-text search and merges candidates. HNSW is present in migrations.
5. **Embedding token-limit guard.** The MiniLM provider checks actual tokenizer length; ingestion has a second fit-to-window step.
6. **Prompt-injection boundary.** Retrieved documents are placed in user content and explicitly marked untrusted rather than inserted into the system instruction.
7. **Citation identity validation.** Model-produced `[S#]` markers are restricted to IDs assigned by the backend. This is useful, although it does not prove entailment.
8. **OCR fallback.** Low-text PDF pages can be rendered and sent through Tesseract, optional PaddleOCR and optional TrOCR.
9. **Source lifecycle.** Source files can be deactivated and indexed documents are excluded when their backing source is inactive.
10. **Dark/cyan UniCheatSheet-styled playground.** The frontend already carries the main site's visual DNA and contains course selection, history, citations, source drawer and responsive CSS.
11. **Production-mode startup guard.** Public mode refuses to start with dev access and requires a CORS allowlist.
12. **Dependency overrides and existing regression tests.** The snapshot includes tests for access isolation, chat persistence, hybrid retrieval, OCR/PYQ parsing, Drive lifecycle and Gemini SSE flush behavior.

---

# 2. Priority legend

| Priority | Meaning |
|---|---|
| **P0** | Launch/integration blocker; fix before connecting paid students. |
| **P1** | Correctness, security, grounding, reliability, or core-product gap; fix before public pilot. |
| **P2** | Important UX, maintainability, accessibility, corpus coverage, or performance work. |
| **P3** | Scale/polish/future expansion; safe to defer until the core product works. |

---

# 3. Current issues and required fixes

## 3.1 Production integration and entitlement boundary

### P0-01 — The real UniCheatSheet website is not connected
**Current:** JWT verification exists, but production UniCheatSheet does not yet issue the token consumed by this repository. The system is still driven by `dev-context.json` locally.

**Fix:** implement a single server-only endpoint in the existing main website, e.g. `POST /api/ai/session`. It must read the website's existing authenticated session and existing paid-access/course visibility logic, derive the exact canonical course IDs already visible to that student, and sign those IDs into a short-lived RS256 JWT (≤15 min). The AI must never independently infer semester/specialization/payment access.

**Acceptance:** two students in the same semester but different specializations receive different course arrays; manually editing `courseId` in an AI request never expands access.

### P0-02 — Production course IDs are provisional
**Current:** `catalog/courses.json` contains development/provisional IDs and the local context contains a mixture of fixture courses. This cannot be treated as entitlement truth.

**Fix:** establish a canonical `course_id` contract shared by: main-site course records, main-site resource records, JWT `courses[]`, AI `Course.id`, catalog entries and indexed chunks. Display names and aliases remain mutable metadata and must never be security keys.

### P0-03 — No authoritative production resource catalog
**Current:** the scanner expects direct Drive links inside `sem*/lecture.html`, `pyqs.html`, and `solutions.html`; the documented local checkout largely contains `href="#"`. Temporary folder catalogs are being used for tests.

**Fix:** stop treating HTML scraping as the long-term source of truth. Export a protected/versioned resource catalog from the main site's real resource store. Required minimum fields:

```ts
Resource {
  id: string;                 // stable website resource ID
  courseId: string;
  semester: number;
  resourceType: 'lecture'|'pyq'|'solution'|'tutorial'|'assignment'|'book'|'syllabus'|'other';
  title: string;
  unit?: string;
  sourceAssetId: string;      // Drive file ID or other provider ID
  sourceProvider: 'google_drive';
  contentFormat: 'typed'|'handwritten'|'mixed'|'scan'|'unknown';
  active: boolean;
}
```

The same export must drive indexing and the website's authorization/resource-opening logic.

### P0-04 — Protected original-resource opening is not implemented
**Current:** direct Drive URLs are deliberately removed in JWT mode. The frontend therefore cannot offer a safe “Open original” in production, and local scanned-page previews are disabled in production.

**Fix:** add stable `resourceId` to AI citations. Main site exposes a protected route such as `/resources/:resourceId/open` that re-checks the current website session and course grant, then serves/redirects to the resource. Never expose raw Drive URLs as the paid-resource authorization boundary.

### P1-05 — Access context only describes courses, not actual resource availability
**Current:** `GET /v1/coverage` returns counts grouped by `courseId` and raw document `type`, but the main-site product is organized around Notes/PYQs/Solutions.

**Fix:** add an academic context/resource availability response that lets the UI know which resource classes actually exist for each allowed course. Do not show “Solutions” for a course if no solution resource exists.

---

## 3.2 API and security

### P1-06 — `accountKey` is an unkeyed SHA-256 of the internal user ID
**File:** `apps/api/src/app.ts:71-74`.

If the website's `sub` is guessable (email, numeric ID, username), SHA-256 is still stable and linkable. It is not a security boundary, but exposing a deterministic fingerprint is unnecessary.

**Fix:** use HMAC-SHA-256 with an AI-server secret or return a random/session-scoped `sessionIdentity` derived from the token JTI. The frontend only needs “did account identity change?”, not a permanent pseudonymous identifier.

### P1-07 — JWT key rotation supports only one static public key
**File:** `apps/api/src/access-context.ts:43-67`.

**Fix:** support `kid` + JWKS or a configured set of active public keys. Keep current strict issuer/audience/lifetime verification.

### P1-08 — Rate/concurrency limiting is process-local
**File:** `apps/api/src/app.ts:26-40`.

This is acceptable for one Hostinger process but breaks if the app is replicated/restarted and the cleanup loops through the entire map on claims.

**Fix:** for the initial one-instance Hostinger deployment, document this limitation and cap concurrency to 1–2. If multiple instances are introduced, use a shared Redis/Upstash-style store or database advisory counters. Keep a cheap global circuit breaker for provider overload.

### P1-09 — Direct retrieval/document endpoints make authorized bulk extraction easier
`POST /v1/retrieve` can return full chunk text and `GET /v1/documents/:id` returns all chunk content for an authorized document. This is not cross-course leakage, but it can turn a paid account into a scraping endpoint.

**Fix:** production UI endpoints should return bounded excerpts. Paginate document reads; consider making raw `/v1/retrieve` developer/admin-only. Add per-route limits and audit logging.

### P1-10 — SSE transport lacks proxy-hardening
**File:** `apps/api/src/app.ts:146-165`.

Add `X-Accel-Buffering: no`, periodic SSE comments/heartbeats for long generations, and backpressure awareness (`write()` return value/drain). Verify Hostinger/reverse proxy idle timeouts.

### P2-11 — API proxy returns development-specific outage text
`apps/playground/src/app/api/ai/[...path]/route.ts` returns “Start it with pnpm dev.” on proxy failure.

**Fix:** production-safe message (“AI service is temporarily unavailable”) with a request/correlation ID; log the actual upstream error server-side.

### P2-12 — Page-image URL is coupled to the playground proxy path
The API emits `/api/ai/chunks/.../page-image`, which is a UI-host route, not an API-domain contract.

**Fix:** return `pageImageAvailable` or `previewResourceId`; let the UI construct a request through its configured API client. Production preview must be access-checked.

### P2-13 — No explicit retention/deletion/privacy workflow
Conversations and excerpts can persist indefinitely.

**Fix:** define retention; add “Delete conversation” and optionally “Delete all AI history”; ensure source excerpts are removed with messages. Document what is stored.

---

## 3.3 Chat orchestration and streaming

### P0-14 — The current “streaming” path is not real model streaming
**File:** `packages/ai-core/src/chat-service.ts:107-123`.

The provider stream is fully consumed into `raw`; only after generation completes does the code validate the answer and then emit it in artificial 240-character “token” blocks. Students therefore wait for the complete model response before seeing answer text.

**Fix:** stream provider text to the client as it arrives **while** buffering the full raw answer. The final `done` event remains authoritative and replaces provisional streamed text after citation/provenance validation. Do not expose raw unvalidated URLs. One practical design:

1. `status: retrieving`
2. `sources`
3. `status: generating`
4. progressive `delta` text from provider
5. server validates complete response
6. `done` contains canonical validated answer/citations/provenance

If strict real-time citation sanitization is required, use structured provider output or delay only citation-bearing blocks rather than the whole response.

### P1-15 — Citation validation proves identity, not support
**File:** `packages/ai-core/src/citation-engine.ts`.

A real `[S1]` can be attached to an unsupported claim and still pass.

**Fix:** move toward structured answer segments/claims:

```json
{
  "segments": [
    {"text":"...", "provenance":"ucs", "sourceIds":["S1","S2"]},
    {"text":"...", "provenance":"general", "sourceIds":[]}
  ]
}
```

Run sentence/claim-level support checks for sourced segments (lightweight model/rule evaluation first; human-evaluated faithfulness benchmark before public launch). Never describe citation validation as proof of truth.

### P1-16 — General model knowledge and UniCheatSheet-grounded material are not represented as separate data
The system prompt allows general teaching knowledge when sources are insufficient, but `ChatResult` has no provenance field. A user can easily read the result as if all content came from UniCheatSheet.

**Fix:** add `answerMode: 'ucs_grounded'|'general_explanation'|'mixed'|'insufficient'` and/or segment-level provenance. UI must label “Based on UniCheatSheet” and “General explanation” separately.

### P1-17 — Explicit product modes are inferred from regex rather than supplied by UI
`routeQuery()` tries to infer PYQ search, practice generation and counts from wording.

**Fix:** retain conservative natural-language routing as fallback, but let UI send explicit `mode`/`resourceTypes` for Notes, PYQs, Solutions and exam-prep actions. The user should not need to phrase “PYQ” exactly for correct retrieval.

### P1-18 — No document-level scope
Current chat schema only has semester/course.

**Fix:** expand scope:

```ts
scope: {
  courseId?: string;
  resourceId?: string;
  documentId?: string;
  resourceTypes?: ResourceType[];
}
```

Validate that document/resource belongs to an allowed course. This enables “Ask AI about this resource”.

### P1-19 — Context selection is just top six hits
**File:** `packages/ai-core/src/context-builder.ts`.

**Fix:** select by token budget and diversity: cap repeated chunks per document/page; prefer distinct evidence; preserve question/section context; include unit/exam metadata. Use MMR or equivalent diversification after retrieval.

### P2-20 — Conversation scope accumulation can over-lock history
`conversation-memory.ts` unions all used course IDs into `allowedCourseIds`. A conversation that briefly switches courses can become hidden if one historical course grant disappears, even when later messages belong to another still-valid course.

**Fix:** decide product semantics explicitly. Recommended: store per-message/source course IDs and compute conversation visibility from whether **all visible paid answer/source content remains authorized**, or keep conversations single-course unless explicitly “All Courses”. Avoid silent scope union surprises.

### P2-21 — Long history has no summarization layer
Only recent messages are kept (good for bounded prompt size), but older context simply disappears.

**Fix:** add a bounded conversation summary after MVP if follow-up quality suffers. Do not introduce an agent framework just for this.

---

## 3.4 Retrieval quality

### P1-22 — Hybrid merge gives lexical candidates absolute priority
**File:** `packages/retrieval/src/index.ts:64-85`.

Any lexical match is sorted ahead of all semantic-only matches. Common query words can therefore outrank a better semantic passage.

**Fix:** use Reciprocal Rank Fusion (RRF) or calibrated weighted fusion. Include exact-phrase/token boosts, but never “lexical exists → always first”. Evaluate by resource type.

### P1-23 — One fixed similarity threshold for every course/resource/query
`RETRIEVAL_MIN_SCORE=0.30` is global.

**Fix:** use labeled evaluations to calibrate behavior by query class/resource type. Exact PYQ token matching should not share the same acceptance logic as conceptual paraphrase. Preserve a conservative no-evidence state.

### P1-24 — No diversification/reranking
Top results can be near-duplicate overlapping chunks from one page/document.

**Fix:** candidate retrieval → fusion → dedupe/near-duplicate suppression → MMR/per-document cap → optional lightweight reranker if evaluation proves it is needed.

### P1-25 — FTS is weak for formulas, acronyms, code and exact exam tokens
`plainto_tsquery('english')` can lose important forms.

**Fix:** add normalized exact-token/phrase search and `pg_trgm` for names/abbreviations; preserve quoted phrases and operators in query normalization. Store aliases/course codes/topic tags separately.

### P1-26 — Retrieval API does not support the metadata the product needs
Add filters for `resourceId`, `documentId`, `unit`, `examType`, `year`, `month`, `program`, `questionNumber`, `marks`, `contentFormat`, and OCR review state.

### P2-27 — Retrieval function can be called internally without `allowedCourseIds`
The API wrapper passes the grants, but `retrieve()` itself permits unscoped calls.

**Fix:** split into `retrieveAuthorized(context, request)` and a clearly named `retrieveAdmin/internal` helper, or require `allowedCourseIds` in the public type. Make unsafe unscoped retrieval difficult by construction.

### P2-28 — Six retrieval smoke cases are too small
The existing eval is useful but not representative.

**Fix:** build a labeled dataset with at least 100–300 queries across courses: exact topic, acronym, paraphrase, PYQ, equation/formula word query, OCR, negative query, cross-course leakage, document-specific query, multi-course query. Track Recall@k, MRR/nDCG, no-hit precision and answer citation faithfulness.

---

## 3.5 Chunking and embeddings

### P1-29 — First-pass chunking is approximate and destroys structure
`chunker.ts` flattens paragraphs to words and estimates tokens using character length.

**Fix:** chunk with the embedding tokenizer from the start and preserve structural units: heading + paragraph; list; question; solution step; slide; table caption. Keep page boundaries for citations.

### P1-30 — Emergency token-window split has no overlap
`fitModelWindow()` splits an oversized chunk into disjoint word windows.

**Fix:** tokenizer-aware sliding split with 10–15% overlap and parent-section metadata. The current hard guard in the embedding provider should remain as final protection.

### P1-31 — Embedding dimensions/model are hardcoded in multiple layers
`384` and `512` appear in provider/ingestion/retrieval/schema assumptions.

**Fix:** expose `dimensions` and `maxInputTokens` from provider; migrations still need a fixed vector type, but runtime validation should reference provider metadata. Record `embeddingModelId` explicitly on each document/chunk/index revision.

### P2-32 — Query embedding model is still a Hostinger runtime model
The deployment guide itself records a ~745 MB Windows deploy artifact including dependencies and an ~86 MB ONNX cache.

**Fix:** before deployment, create a production bundle/pruned workspace and benchmark **Linux** disk/RAM/cold start. Do not deploy ingestion/OCR packages. If MiniLM still does not fit the actual Hostinger quota, choose a smaller/quantized compatible embedding model and reindex the entire corpus, or host a small always-on embedding service elsewhere. Never use different query/document embedding models.

---

## 3.6 PDF, handwriting, OCR and visual material

### P1-33 — OCR does duplicate work
Node runs Tesseract text + TSV. If quality is weak, it starts the Python worker, which runs Tesseract text + TSV again before considering Paddle/TrOCR.

**Fix:** choose one orchestration layer. Recommended: Node renders pages and sends a batch job to a long-lived Python OCR worker; Python performs baseline Tesseract once, then optional fallback engines.

### P1-34 — TrOCR/Paddle models are loaded for every page
`scripts/ocr_page.py` constructs `PaddleOCR`, `TrOCRProcessor`, and `VisionEncoderDecoderModel` inside page-level functions. With a new Python process per page, model startup dominates ingestion.

**Fix:** replace per-page process execution with a persistent local worker or one document/batch invocation. Load model(s) once, process all requested pages, then exit/idle. This is one of the highest-impact ingestion performance fixes.

### P1-35 — Handwriting line segmentation is fragile
Projection-based line detection assumes a fairly clean, light page and simple line layout. Ruled notebooks, shadows, multi-column notes, diagrams and rotated photos can fail.

**Fix:** preprocessing pipeline: orientation detection → deskew → perspective correction when needed → contrast/illumination normalization → text-line detection. Keep Tesseract/Paddle/TrOCR fallbacks modular and benchmark on actual UniCheatSheet handwriting.

### P1-36 — Math/formulas/diagrams cannot be trusted through ordinary OCR
**Fix:** treat OCR text primarily as a retrieval index. Preserve a reference to the original page/resource and mark formula/diagram-heavy or uncertain pages for visual review. Do not silently “correct” equations using an LLM. For free-tier operation, manual/original-page verification is preferable to paid math OCR.

### P1-37 — Production page verification is currently disabled
This conflicts with handwriting being a first-class source type.

**Fix:** production citation drawer should open the protected original resource/page. If page thumbnails are later stored, put them outside Hostinger's 1.1 GB app footprint and protect them with entitlement checks.

### P2-38 — Native PDF layout reconstruction is too simple
PDF.js grouping is mainly based on Y-coordinate changes; columns/tables/slides can read in wrong order.

**Fix:** include X/Y geometry; cluster lines/blocks; detect columns; preserve slide/page headings. Add visual regression fixtures for multi-column notes and tables.

### P2-39 — OCR trigger can miss “long garbage”
Length ≥80 plus a broad readable-character heuristic can accept technically corrupted equations/text.

**Fix:** page-quality scoring should include word confidence, symbol density, character repetition, text coverage and extraction consistency. Flag native-text pages with suspected formula corruption too.

### P2-40 — Document-level OCR readiness is too coarse
A document can pass because some pages contain text even when many others are empty.

**Fix:** compute per-document text coverage: percentage of readable pages, number of unresolved pages, unresolved critical pages. Mark `partial`, `needs_review`, or `ocr_required` instead of a single total-character cutoff.

### P2-41 — Only PDF is searchable
**Fix order:** PDF first (keep); then DOCX; PPTX/slide text; plain text/HTML; images. Only add XLSX if actual course resources require it.

---

## 3.7 Ingestion and source lifecycle

### P1-42 — Indexing invalidation key is incomplete
Current key does not robustly encode every parser/OCR setting/version (e.g. DPI, OCR language, Paddle flag/model versions, chunker/parser version).

**Fix:** create explicit `INGESTION_PIPELINE_VERSION` and include parser version, chunker version, embedding ID, chunk settings, OCR engine/model/lang/DPI/preprocessing version, PYQ parser version. Any semantic processing change must mark a document stale.

### P1-43 — Failed replacement indexing has ambiguous state
The code intentionally preserves old indexed content if a new revision fails, but the schema does not clearly represent “last successful revision vs failed new revision”.

**Fix:** add `DocumentRevision` or revision fields (`activeRevision`, `pendingChecksum`, `lastSuccessfulAt`, `lastFailure`). Continue serving last-good content but surface stale/update-failed state to admins.

### P2-44 — Row-by-row chunk insert is inefficient
**Fix:** use batched multi-row inserts/COPY/raw `VALUES` batches in one transaction. This matters when full semesters are reindexed.

### P2-45 — Duplicate Drive sync implementations
There is both cache sync (`syncResources`) and DB/index-oriented `RcloneIdSource` logic.

**Fix:** consolidate around one source adapter + one cache lifecycle. Keep one manifest format and one retry/error model.

### P2-46 — Scanner deduplicates by Drive ID and discards subsequent logical references
A single physical file may legitimately appear in multiple course/resource contexts.

**Fix:** separate physical `SourceAsset` from logical `Resource`. Many logical resources may reference one asset. Deduplicate the asset, not the website relationship.

### P2-47 — Fixed manifest temp name in one sync path can collide
Use random/unique temp names and an ingestion/sync lock. Prevent overlapping scheduler runs.

### P2-48 — Hard 25 MB PDF limit is duplicated
Make it a validated environment/config value and log rejected resources into ingestion status rather than only throwing.

---

## 3.8 Database/data-model gaps

### P0-49 — No first-class `Resource` entity
The current schema jumps from Course → AcademicDocument/SourceFile. The product needs a stable representation of what the website sells/displays.

**Add:**

```prisma
model Resource {
  id             String @id
  courseId       String
  resourceType   ResourceType
  title          String
  unit           String?
  contentFormat  ContentFormat
  active         Boolean @default(true)
  sourceAssetId  String?
  metadata       Json
  // protected website route key, not raw Drive authorization
}
```

`AcademicDocument` becomes the parsed/indexed representation of a resource revision, not the product/resource identity itself.

### P1-50 — Critical status/type fields are free-form strings
Use Prisma enums or database check constraints for resource type, document status, visibility, role, sync/index status, extraction method.

### P1-51 — Structured PYQ fields are missing
Add `ExamPaper`/metadata: exam type (mid/end), year, month/session, program, course code; `ExamQuestion`: question number/subpart, marks, CO if present, unit/topic tags, page, exact/ocr flag.

### P1-52 — Future private LMS schema is only partially modeled
`ownerUserId` exists, but retrieval currently hardcodes `visibility='global'`.

**Later LMS phase:** retrieval visibility becomes `(global) OR (private AND owner_user_id=currentUser)`, with course entitlement **and** ownership filters. Do not ship LMS until global UniCheatSheet source quality is stable.

### P2-53 — No user feedback/retrieval telemetry schema
Add privacy-conscious `AiRequestMetric`/feedback fields: latency, provider status, retrieval count, no-hit reason, selected source IDs, explicit thumbs up/down; never log raw paid content unnecessarily.

---

## 3.9 LLM provider reliability

### P1-54 — Gemini has no retry/backoff/circuit breaker
Free-tier 429/503 is expected under load.

**Fix:** bounded exponential backoff for safe retry statuses, jitter, max total deadline, circuit breaker, clear degradation. If generation is unavailable, still let users browse/search sources and PYQs deterministically.

### P1-55 — Production answer quality is not yet proven
The repository's own audit records live Gemini timeouts/503s and explicitly says answer quality/latency was not verified.

**Fix:** run a human-evaluated grounded-answer set on the real production corpus before launch. Record correctness, citation support, incomplete-answer handling and provider latency.

### P2-56 — Ollama provider has two correctness issues
`generate()` can silently return an empty string; the streaming parser does not flush a final NDJSON object if the response ends without newline.

**Fix:** throw on empty generated answer and flush the final buffer exactly as Gemini's SSE implementation does.

### P2-57 — Provider capabilities are implicit
Add provider metadata: model name, supportsStreaming, max output, configured timeout. Log provider/model in metrics, not secrets.

---

## 3.10 Frontend/code quality issues

### P1-58 — UI does not implement the UniCheatSheet resource mental model
Current welcome suggestions are generic (`Explain a topic`, `Find PYQs`, `Make revision notes`). Implement the product changes in Section 4 below.

### P1-59 — No real-time autoscroll during true streaming
`Workspace.tsx` scroll effect depends on `messages.length` and status, not growing assistant content. Once P0-14 is fixed, long streaming text can grow below the viewport without following.

**Fix:** track the latest message content/height with `ResizeObserver`, while respecting users who scroll upward.

### P2-60 — Source cards show course ID slug
Use course display name, resource type, unit/exam metadata and OCR badge. Keep raw ID internal.

### P2-61 — User avatar is hard-coded as `Y`
Use a neutral user icon or optional safe display initial from host UI context. Do not derive/display account identity from opaque `sub`.

### P2-62 — No KaTeX/math rendering despite architecture claims
Current UI has `react-markdown`/GFM but no math plugin.

**Fix:** add `remark-math` + `rehype-katex` (or equivalent) and CSS. Sanitize/limit raw HTML; continue not allowing arbitrary model HTML.

### P2-63 — Sidebar accessibility is incomplete
SourceDrawer has a manual focus loop, but the chat-history drawer only handles Escape and does not trap/inert background or move focus into the drawer.

**Fix:** implement dialog semantics/focus management consistently or use an accessible headless dialog primitive. Test keyboard and screen readers.

### P2-64 — Some touch targets are below 44px
Composer add/send and some icon controls are ~31–38px.

**Fix:** retain visual size if desired but enlarge hit area/minimum interactive box.

### P2-65 — CSS contains overlapping/legacy rules
The stylesheet defines sidebar/chat layout in one form and later overrides it for drawer behavior, plus unused select styles.

**Fix:** split `globals.css` into tokens/base + landing + chat + components, remove dead legacy declarations, and add visual regression screenshots.

### P2-66 — No frontend component/E2E tests
Add Playwright tests for: landing, course selector keyboard behavior, real streaming, cancellation, source drawer, history, session refresh/401, mobile layout, cross-account reset, network loss.

### P2-67 — Context refresh is unnecessarily broad
The provider reloads academic context on pathname change and browser focus, then may fetch history/coverage each time.

**Fix:** cache within token lifetime, refresh on configured session change/401/focus after a minimum stale interval. Preserve access correctness.

---

# 4. Product redesign required by the real UniCheatSheet experience

This section incorporates **all product changes discussed from “What the current UniCheatSheet experience tells us” onward**.

## 4.1 Core product principle

UniCheatSheet AI should **not** be positioned as “ChatGPT trained on UniCheatSheet”. It should be the intelligent interface to the resource structure students already know:

```text
Paid student access
    ↓
Allowed semester/specialization courses (decided by main site)
    ↓
Course
    ↓
Notes / PYQs / Solutions
    ↓
Unit / paper / tutorial / resource
    ↓
Ask, browse, revise, analyse, cite
```

The AI never decides what the student bought. It only works inside the exact course set the main website signs.

## 4.2 Landing screen

Keep the current UniCheatSheet visual DNA: black/deep navy, `#00e5ff`, Inter/Montserrat, glassy low-contrast surfaces, subtle glow.

Recommended hierarchy:

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

## 4.3 Notes / PYQs / Solutions become first-class modes

These are explicit UI filters, not regex guesses:

- **Notes:** `resourceTypes=['lecture','book','syllabus']` as appropriate.
- **PYQs:** `resourceTypes=['pyq']`, with exam metadata filters.
- **Solutions:** `resourceTypes=['solution','tutorial','assignment']` according to your catalog semantics.

The mode changes suggestions and retrieval filters but does not require a different model.

## 4.4 Course-first home

Show only `allowedCourses` received from `/v1/me/context`. Clicking a course sets `courseId` and loads its resource/coverage summary. Never list all indexed database courses.

## 4.5 Browse material inside AI

Add `GET /v1/resources?courseId=...&type=...`. Render the same familiar hierarchy:

```text
Operating Systems
  Lecture Notes
    Unit 1 ...     [Open] [Ask AI]
    Unit 2 ...     [Open] [Ask AI]
  PYQs
    2025 End-Sem   [Open] [Ask AI]
  Solutions
    Tutorial 3     [Open] [Ask AI]
```

This solves the blank-chat problem: students can discover material without knowing what to ask.

## 4.6 “Ask AI” on every existing main-site resource

Main site should add contextual `Ask AI` actions. Handoff can include `currentCourseId` and a protected `resourceId`/one-time launch context. The AI starts in document/resource scope.

**Do not put a long-lived JWT in a URL.** Use same-origin session endpoint + in-memory token, or a one-time exchange code if the UI lives on `ai.` subdomain.

## 4.7 Three academic scopes

1. **This document/resource** — search only selected resource/document.
2. **This course** — search all entitled resources in one course.
3. **All my courses** — search only the exact signed course list.

UI text should be human: “This document”, “Cryptography”, “All Courses”.

## 4.8 Citation cards become resource-aware

Instead of just `[S1]` + slug:

```text
[1] Cryptography · Lecture Notes
    AES — Unit 4
    Page 17
    Typed / Handwritten (if relevant)
    [Open original]
```

The original button resolves through the protected main-site resource route.

## 4.9 Handwritten material is a normal source type

Catalog `contentFormat` and extraction metadata. Display `Handwritten`/`OCR—check original` badges. OCR is for searchability; original page/resource remains the authority for formulas, symbols and exact wording.

## 4.10 Exam-aware PYQ model

Store and expose:

- `examType`: mid-sem / end-sem / other
- `year`
- `month/session`
- `program`
- `questionNumber`
- `subpart`
- `marks`
- `courseOutcome` if present
- `unit/topic tags`
- source page and OCR review state

## 4.11 PYQ intelligence

Build deterministic analytics over indexed question records:

- repeated topics and frequency;
- years/exams in which a topic appears;
- question/marks distribution;
- exact past questions vs generated practice;
- “most repeated topics” with source links.

Do not ask the LLM to guess frequency from top-k chunks. Query structured PYQ data.

## 4.12 Exam-preparation actions

Course page actions:

- Quick Revision
- Most Important Topics (clearly based on available notes/PYQ frequency, not certainty of future exam)
- Repeated PYQs
- Unit Summaries
- Generate Practice Test
- Explain a Topic

Generated practice must be labeled **Generated practice**, never presented as a real PYQ.

## 4.13 Source coverage

Display what the AI actually has indexed:

```text
Unit 1 ✓
Unit 2 ✓
Unit 3 Partial
PYQs ✓ 5 papers
Solutions Partial
Handwritten pages: 18 (3 need review)
```

Coverage is data, not a promise that the corpus is complete.

## 4.14 Provenance labels

UI should clearly distinguish:

- **Based on UniCheatSheet** — supported by indexed sources.
- **General explanation** — model teaching knowledge, not claimed to be in UniCheatSheet.
- **Mixed** — visually segmented.
- **Not enough indexed material** — no invented source claim.

---

# 5. Target data model

Recommended conceptual schema (adapt to Prisma):

```text
Course
  └── Resource                     # product identity shown by website
        ├── resourceType
        ├── unit / ordering
        ├── contentFormat
        ├── protectedResourceKey
        └── SourceAsset             # physical Drive item
              └── DocumentRevision  # parsed/indexed revision
                    ├── PageExtraction[]
                    ├── DocumentChunk[]
                    └── ExamQuestion[] (for PYQ)
```

### Key additions

- `Resource.id`: stable ID shared with main website.
- `Resource.courseId`.
- `Resource.resourceType` enum.
- `Resource.unit`, `sortOrder`, `title`.
- `Resource.contentFormat` enum.
- `Resource.metadata`.
- `SourceAsset.provider`, `remoteFileId`, hash/state.
- `DocumentRevision.pipelineKey`, checksum, status, indexedAt, previous-good relationship.
- `ExamPaper` structured metadata.
- `ExamQuestion` structured metadata + exact text + page + OCR state.
- optional `Topic`/tag relation later, only if automatic tagging evaluation is good.

Do **not** put payment/subscription tables in the AI database. The main website remains the authority.

---

# 6. Target API contract

## Access/context

`GET /v1/me/context`

```json
{
  "semester": 4,
  "allowedCourses": [{"id":"cryptography","name":"Cryptography"}],
  "currentCourseId": "cryptography",
  "resourceAvailability": {
    "cryptography": ["lecture","pyq","solution"]
  },
  "sessionIdentity": "non-linkable-change-key"
}
```

## Resources

- `GET /v1/resources?courseId=&type=&unit=`
- `GET /v1/resources/:resourceId`
- do **not** return raw Drive authorization URLs in production.

## Chat

```json
POST /v1/chat/stream
{
  "message": "Explain cache mapping",
  "conversationId": null,
  "mode": "notes",
  "scope": {
    "courseId": "computer-architecture",
    "resourceId": "coa-unit-4"
  }
}
```

The server intersects every requested scope with the signed entitlement context.

## PYQ analytics

- `GET /v1/pyqs?courseId=&year=&examType=&topic=`
- `GET /v1/pyqs/topics?courseId=`
- `GET /v1/pyqs/repeated?courseId=`

Use deterministic DB queries; LLM is for explanation, not counting.

## Citations

Return `resourceId`, course name, resource type, unit/exam metadata, page, extraction/review state, and excerpt. Frontend resolves `Open original` through main-site protected route.

---

# 7. Free-tier + Hostinger deployment architecture

Given the stated ~1.1 GB Hostinger constraint, keep production split:

```text
INGESTION PC (your RTX machine; runs when content changes)
Drive/rclone → PDF parser → OCR/TrOCR/Paddle → chunk → document embeddings
                                      ↓
                              remote pgvector DB

HOSTINGER (small always-on runtime)
Fastify API + JWT verify + query embedding + retrieval + LLM API client + SSE
                                      ↓
                              remote pgvector DB

MAIN UNICHEATSHEET HOST
existing login/payment/access → short-lived AI JWT + protected resource route
```

### Never deploy to Hostinger

- rclone OAuth/config;
- PDF cache;
- page-image cache;
- Poppler/Tesseract/Paddle/TrOCR/Python environment;
- local document-ingestion jobs;
- local LLM/Ollama;
- sample corpus.

### Hostinger optimization work

1. Build/prune only `@ucs/api` + runtime workspaces.
2. Prefer compiled/bundled production JS rather than `tsx` as the production runner.
3. Measure Linux package size, ONNX cache, cold-start RAM and query latency.
4. Put PostgreSQL/pgvector externally (free tier where practical); monitor DB size.
5. Keep `AI_MAX_CONCURRENT_CHATS=1` initially.
6. Generation provider must degrade cleanly under free-tier quota limits; source browsing/search still works.
7. If MiniLM runtime does not fit, do **not** swap query model alone. Change embedding model for both documents and queries and reindex.

---

# 8. Implementation phases — exact order

## Phase 0 — Freeze and baseline (1–2 days)

**Goal:** make future changes measurable.

- Tag current repository snapshot.
- Fresh install/build/typecheck/tests on a clean machine/database.
- Record current API package size/RAM/cold start.
- Record retrieval evaluation baseline.
- Add `INGESTION_PIPELINE_VERSION`.
- Add production-vs-fixture warnings in admin scripts.

**Exit criteria:** reproducible baseline and rollback point.

## Phase 1 — Canonical production catalog + resource model (highest priority)

- Define canonical course IDs with main website.
- Add `Resource` + source asset/revision structure.
- Export authoritative resource catalog from main website/backend.
- Import real Notes/PYQs/Solutions metadata.
- Remove production dependence on HTML `href` scraping.
- Preserve multiple logical resources referencing one Drive file.
- Add protected `resourceId` mapping.

**Exit:** every paid website resource has stable `resourceId`, `courseId`, `resourceType`, source asset ID; AI index uses same IDs.

## Phase 2 — Real main-site entitlement bridge

- Implement main website `POST /api/ai/session` from existing login/payment/course state.
- RS256/JWKS or multi-key verifier.
- In-memory token provider in AI UI.
- No token in URL/localStorage.
- `/v1/me/context` exposes only signed courses and actual resource availability.
- End-to-end tests for specialization differences, logout, expiry, revoked course, account switch.

**Exit:** a student can never see/search a course that main UniCheatSheet does not currently expose to them.

## Phase 3 — Protected citations/resource opening

- AI citations use `resourceId`.
- Main site protected open route validates current grant.
- Citation drawer displays resource metadata/OCR state.
- Handwritten citation can open original page/resource.
- Remove raw Drive links from production responses and stored public-facing citation objects where not needed.

**Exit:** revoked user cannot reuse an old AI citation to open paid material.

## Phase 4 — RAG correctness + real streaming

- Implement genuine incremental SSE.
- Add heartbeat/proxy handling.
- Add provenance model (`grounded/general/mixed/insufficient`).
- RRF hybrid ranking + diversity.
- tokenizer-native structural chunking with overlap.
- resource/document/type metadata filters.
- claim-support evaluation and larger retrieval eval suite.
- Gemini retry/backoff/circuit breaker; fix Ollama final-buffer/empty-answer behavior.

**Exit:** real tokens appear promptly, final `done` is validated; labeled eval meets target thresholds; unsupported source claims are clearly separated/refused.

## Phase 5 — UniCheatSheet-native AI product UI

Implement the complete experience from Section 4:

- landing copy/semester label;
- Notes/PYQs/Solutions modes;
- Your Courses cards;
- Browse Material;
- This Document / This Course / All Courses scopes;
- main-site `Ask AI` entry points;
- resource cards with Open/Ask AI;
- provenance badges;
- source coverage;
- quick revision/exam actions;
- math rendering;
- true-stream autoscroll;
- accessibility/touch/focus cleanup;
- CSS refactor.

**Exit:** the AI feels like part of UniCheatSheet, not a separate chatbot.

## Phase 6 — PYQ intelligence

- structured exam-paper/question extraction;
- admin review for OCR/metadata;
- topic tagging pipeline with confidence/review;
- repeated-topic analytics;
- years/exams/marks filters;
- generated practice clearly separated from real PYQs.

**Exit:** counts/frequency are deterministic and traceable to actual papers.

## Phase 7 — Handwriting/OCR productionization

- persistent/batch Python worker on ingestion PC;
- one Tesseract pass;
- model caching;
- deskew/orientation/dewarp/illumination preprocessing;
- quality/review dashboard;
- per-document OCR coverage;
- manual spot-check set for formulas and handwritten notes.

**Exit:** searchable handwriting with explicit review state; no claim of exact equation transcription without verification.

## Phase 8 — Hostinger/free-tier release hardening

- Linux production bundle size/RAM benchmark;
- external pgvector DB migration/backup/restore test;
- concurrency/load test;
- structured logging/correlation IDs;
- route-specific rate limits;
- privacy/retention/delete flows;
- uptime/provider failure fallback;
- staging rollout → small student cohort → wider release.

**Exit:** real entitled accounts pass security/access/load/citation tests on actual hosting.

## Phase 9 — LMS connector (later)

Only after the UniCheatSheet corpus works reliably:

- authorized per-user LMS sync;
- private `ownerUserId` documents;
- global OR own-private retrieval;
- same canonical course IDs;
- same resource/provenance/citation model.

Do not let LMS complexity block the core paid UniCheatSheet AI launch.

---

# 9. Test plan that must be added

## Access/security

- valid token, expired token, altered signature, wrong `iss`, wrong `aud`, old key/new key;
- course absent from token via chat/retrieve/chunk/document/resource/history;
- two students same semester different specialization;
- revoked course within token TTL and after refresh;
- account switch in same browser tab;
- protected resource URL after revocation;
- scraping/pagination/rate-limit behavior.

## Retrieval

- exact technical terms;
- acronyms/course codes;
- paraphrases;
- formula-adjacent text;
- OCR typo variants;
- negative/unrelated queries;
- cross-course leakage;
- document-only scope;
- Notes/PYQ/Solution filters;
- duplicate chunks/diversity.

## RAG/grounding

- claim cited by wrong real source;
- prompt injection inside PDF;
- source says one thing/model prior says another;
- insufficient material;
- general explanation correctly labeled;
- real PYQ vs generated practice;
- OCR uncertainty.

## UI/E2E

- keyboard course selector;
- screen reader dialog/history;
- real streaming and Stop;
- user scrolls up while stream continues;
- token refresh mid-session;
- offline/network loss;
- 390px mobile, tablet, desktop;
- source drawer/protected original;
- no courses/access denied state;
- different specialization user context.

## Ingestion

- typed PDF;
- scanned print;
- handwriting;
- rotated/perspective page;
- multi-column page;
- table;
- formula-heavy page;
- duplicate Drive asset used by two resources;
- changed source hash;
- failed replacement preserving last-good revision;
- removed resource reconciliation.

---

# 10. Definition of production-ready

The system is ready for a real student pilot only when all are true:

- Main site, not AI, determines exact course grants.
- Production canonical course/resource IDs are shared by website and AI.
- Full intended production catalog is indexed and coverage is measurable.
- No direct raw Drive link is used as the paid authorization boundary.
- Every protected AI route enforces signed allowed courses.
- This-document/course/all-course scopes cannot cross grants.
- Real streaming works through production proxy/Hostinger.
- Grounded vs general knowledge is visibly distinguished.
- PYQ results are actual indexed questions; practice is explicitly generated.
- Handwritten/OCR sources are flagged and original can be checked.
- Retrieval/grounding evaluation is materially larger than current smoke tests.
- Provider failures degrade gracefully.
- Hostinger Linux package + MiniLM fits the actual 1.1 GB quota with measured headroom.
- DB backup/restore has been tested.
- Conversation retention/deletion policy exists.
- Mobile/keyboard/screen-reader flows pass.

---

# 11. Recommended immediate next 10 coding tasks

1. Add `Resource` model + migration and stable `resourceId` to citations.
2. Define/import the **real** main-site canonical course/resource export.
3. Implement `POST /api/ai/session` in the main website and run the AI in JWT mode against staging.
4. Implement main-site protected resource opening.
5. Expand `chatSchema` with explicit `mode`, `resourceTypes`, `resourceId/documentId` scope.
6. Add `/v1/resources` and resource availability to context.
7. Fix fake streaming and SSE proxy behavior.
8. Add provenance to `ChatResult` and frontend labels.
9. Replace lexical-first merge with RRF + diversity and expand the eval dataset.
10. Build Notes/PYQs/Solutions + Your Courses + Browse Material UI on top of those APIs.

Do those **before** spending time on LMS, agents, uploads, voice, or fine-tuning.

---

# 12. File-by-file change map (runtime files)

| File/area | Action |
|---|---|
| `apps/api/src/access-context.ts` | keep strict grant validation; add multi-key/JWKS; optional JTI/session identity support |
| `apps/api/src/app.ts` | resource routes, protected preview contract, HMAC/session identity, SSE heartbeat/backpressure, safer raw-content routes |
| `apps/api/src/server.ts` | production config validation incl. DB/LLM/embedding; keep dev mode impossible publicly |
| `apps/playground/.../route.ts` | production outage text, forward needed resource routes/headers |
| `useChatWorkspace.tsx` | explicit mode/resource scope, smarter context refresh, streaming/autoscroll state, provenance |
| `WelcomeScreen.tsx` | Notes/PYQs/Solutions, Your Courses, quick actions, coverage |
| `ChatComposer.tsx` | mode/scope UX; remove disabled upload until useful or keep unobtrusive |
| `ScopeSelector.tsx` | Document/Course/All scopes; user-facing wording |
| `ChatMessage.tsx` | provenance sections + math rendering; neutral avatar |
| `SourceCard.tsx` | course name/resource type/unit/exam/OCR badges |
| `SourceDrawer.tsx` | protected original, production preview contract, richer metadata |
| `ChatSidebar.tsx` | focus/inert accessibility and delete controls |
| `globals.css` | split/refactor; touch targets; remove legacy duplicate rules |
| `ai-client.ts` | resource/PYQ APIs, provenance types, token/session retry semantics |
| `packages/ai-core/chat-service.ts` | real stream, explicit modes/scopes, provenance, diversified context |
| `citation-engine.ts` | structured citations/claims; avoid identity-only “grounded” implication |
| `context-builder.ts` | token budget, diversity, rich metadata, bounded excerpts |
| `conversation-memory.ts` | explicit scope semantics, retention/delete, optional summary later |
| `query-router.ts` | conservative fallback only; preserve technical phrases; UI sends explicit mode |
| `prompt-builder.ts` | structured provenance output; mode-specific instructions |
| `pyq-browser.ts` | replace regex-only browse with structured `ExamQuestion` queries |
| `packages/retrieval/index.ts` | RRF, metadata filters, diversity/reranking, authorized wrapper |
| `packages/embeddings/local.ts` | expose max tokens/dimensions; deployment footprint benchmark |
| `document-processing/chunker.ts` | tokenizer-aware structural chunks + overlap |
| `document-processing/pdf.ts` | better layout/quality/coverage handling |
| `document-processing/ocr.ts` | remove duplicate Tesseract orchestration; batch worker interface |
| `scripts/ocr_page.py` | persistent/batch model load; deskew/orientation; stronger segmentation |
| `ingestion/src/index.ts` | comprehensive pipeline key, revision model, batch inserts, rich metadata |
| `drive-sync/*` | consolidate source/cache flow, locking, random manifest temps, streaming hashes |
| `unicheatsheet-source/*` | authoritative resource importer; don't discard duplicate logical refs |
| `prisma/schema.prisma` | Resource/Revision/Exam metadata/enums/feedback/retention-ready schema |
| `deploy/HOSTINGER_HANDOFF.md` | update after real quota/plan benchmark and final external DB choice |
| tests/evals | larger retrieval/grounding/access/E2E/OCR suites |

---

# 13. Audit coverage manifest

The following is the source/config inventory parsed from the uploaded archive. “Reviewed” here means included in the audit sweep; generated lock resolution is not treated as handwritten application logic.

| Path | Lines | Review class |
|---|---:|---|
| `.env.example` | 50 | source/config reviewed |
| `.gitignore` | 21 | source/config reviewed |
| `PROJECT_AND_WEBSITE_INTEGRATION.md` | 323 | documentation/claims reviewed |
| `PROJECT_AUDIT_2026-09-29.md` | 67 | documentation/claims reviewed |
| `PROJECT_REVIEW.md` | 371 | documentation/claims reviewed |
| `README.md` | 172 | documentation/claims reviewed |
| `apps/api/package.json` | 23 | source/config reviewed |
| `apps/api/src/access-context.ts` | 78 | source/config reviewed |
| `apps/api/src/app.ts` | 176 | source/config reviewed |
| `apps/api/src/server.ts` | 13 | source/config reviewed |
| `apps/api/tsconfig.json` | 5 | source/config reviewed |
| `apps/playground/.env.example` | 1 | source/config reviewed |
| `apps/playground/AGENTS.md` | 9 | documentation/claims reviewed |
| `apps/playground/CLAUDE.md` | 1 | documentation/claims reviewed |
| `apps/playground/next-env.d.ts` | 7 | source/config reviewed |
| `apps/playground/next.config.ts` | 3 | source/config reviewed |
| `apps/playground/package.json` | 27 | source/config reviewed |
| `apps/playground/src/app/api/ai/[...path]/route.ts` | 24 | source/config reviewed |
| `apps/playground/src/app/chat/[id]/page.tsx` | 2 | source/config reviewed |
| `apps/playground/src/app/globals.css` | 46 | source/config reviewed |
| `apps/playground/src/app/layout.tsx` | 7 | source/config reviewed |
| `apps/playground/src/app/page.tsx` | 2 | source/config reviewed |
| `apps/playground/src/components/ai/ChatComposer.tsx` | 22 | source/config reviewed |
| `apps/playground/src/components/ai/ChatMessage.tsx` | 19 | source/config reviewed |
| `apps/playground/src/components/ai/ScopeSelector.tsx` | 56 | source/config reviewed |
| `apps/playground/src/components/ai/SourceCard.tsx` | 7 | source/config reviewed |
| `apps/playground/src/components/ai/SourceDrawer.tsx` | 52 | source/config reviewed |
| `apps/playground/src/components/ai/ThinkingState.tsx` | 8 | source/config reviewed |
| `apps/playground/src/components/ai/WelcomeScreen.tsx` | 26 | source/config reviewed |
| `apps/playground/src/components/ai/Workspace.tsx` | 36 | source/config reviewed |
| `apps/playground/src/components/navigation/ChatSidebar.tsx` | 31 | source/config reviewed |
| `apps/playground/src/components/navigation/Header.tsx` | 14 | source/config reviewed |
| `apps/playground/src/hooks/useChatWorkspace.tsx` | 158 | source/config reviewed |
| `apps/playground/src/lib/api/ai-client.ts` | 92 | source/config reviewed |
| `apps/playground/src/types/chat.ts` | 12 | source/config reviewed |
| `apps/playground/tsconfig.json` | 41 | source/config reviewed |
| `catalog/courses.json` | 8 | source/config reviewed |
| `catalog/drive-folders.json` | 20 | source/config reviewed |
| `catalog/folder-resources.json` | 112 | source/config reviewed |
| `catalog/local-resources.json` | 3 | source/config reviewed |
| `catalog/resources.json` | 1 | source/config reviewed |
| `catalog/resources.raw.json` | 1 | source/config reviewed |
| `catalog/temporary-drive-resources.json` | 35 | source/config reviewed |
| `data/samples/dbms/.gitkeep` | 1 | artifact/placeholder reviewed structurally |
| `deploy/Caddyfile.example` | 4 | source/config reviewed |
| `deploy/HOSTINGER_HANDOFF.md` | 85 | documentation/claims reviewed |
| `deploy/cloudflared.example.yml` | 7 | source/config reviewed |
| `dev-context.json` | 11 | source/config reviewed |
| `docker-compose.yml` | 18 | source/config reviewed |
| `evals/retrieval.json` | 8 | source/config reviewed |
| `package.json` | 56 | source/config reviewed |
| `packages/ai-core/package.json` | 1 | source/config reviewed |
| `packages/ai-core/src/chat-service.ts` | 125 | source/config reviewed |
| `packages/ai-core/src/citation-engine.ts` | 7 | source/config reviewed |
| `packages/ai-core/src/context-builder.ts` | 11 | source/config reviewed |
| `packages/ai-core/src/conversation-memory.ts` | 34 | source/config reviewed |
| `packages/ai-core/src/index.ts` | 5 | source/config reviewed |
| `packages/ai-core/src/prompt-builder.ts` | 10 | source/config reviewed |
| `packages/ai-core/src/pyq-browser.ts` | 50 | source/config reviewed |
| `packages/ai-core/src/query-router.ts` | 23 | source/config reviewed |
| `packages/ai-core/src/types.ts` | 7 | source/config reviewed |
| `packages/ai-core/tsconfig.json` | 1 | source/config reviewed |
| `packages/database/package.json` | 1 | source/config reviewed |
| `packages/database/src/index.ts` | 4 | source/config reviewed |
| `packages/database/tsconfig.json` | 1 | source/config reviewed |
| `packages/document-processing/package.json` | 1 | source/config reviewed |
| `packages/document-processing/src/chunker.ts` | 48 | source/config reviewed |
| `packages/document-processing/src/cleaner.ts` | 3 | source/config reviewed |
| `packages/document-processing/src/exam-questions.ts` | 30 | source/config reviewed |
| `packages/document-processing/src/index.ts` | 9 | source/config reviewed |
| `packages/document-processing/src/ocr.ts` | 82 | source/config reviewed |
| `packages/document-processing/src/parser.ts` | 37 | source/config reviewed |
| `packages/document-processing/src/pdf.ts` | 78 | source/config reviewed |
| `packages/document-processing/src/types.ts` | 53 | source/config reviewed |
| `packages/document-processing/tsconfig.json` | 1 | source/config reviewed |
| `packages/drive-sync/package.json` | 1 | source/config reviewed |
| `packages/drive-sync/src/downloader.ts` | 83 | source/config reviewed |
| `packages/drive-sync/src/id-source.ts` | 134 | source/config reviewed |
| `packages/drive-sync/src/index.ts` | 7 | source/config reviewed |
| `packages/drive-sync/src/manifest.ts` | 33 | source/config reviewed |
| `packages/drive-sync/src/rclone.ts` | 16 | source/config reviewed |
| `packages/drive-sync/src/synchronizer.ts` | 75 | source/config reviewed |
| `packages/drive-sync/src/types.ts` | 41 | source/config reviewed |
| `packages/drive-sync/tsconfig.json` | 1 | source/config reviewed |
| `packages/embeddings/package.json` | 1 | source/config reviewed |
| `packages/embeddings/src/index.ts` | 2 | source/config reviewed |
| `packages/embeddings/src/local.ts` | 32 | source/config reviewed |
| `packages/embeddings/src/provider.ts` | 6 | source/config reviewed |
| `packages/embeddings/tsconfig.json` | 1 | source/config reviewed |
| `packages/indexing/package.json` | 1 | source/config reviewed |
| `packages/indexing/src/index-document.ts` | 32 | source/config reviewed |
| `packages/indexing/src/index.ts` | 2 | source/config reviewed |
| `packages/indexing/src/types.ts` | 8 | source/config reviewed |
| `packages/indexing/tsconfig.json` | 1 | source/config reviewed |
| `packages/ingestion/package.json` | 1 | source/config reviewed |
| `packages/ingestion/src/index.ts` | 109 | source/config reviewed |
| `packages/ingestion/tsconfig.json` | 1 | source/config reviewed |
| `packages/providers/llm/package.json` | 1 | source/config reviewed |
| `packages/providers/llm/src/gemini.ts` | 58 | source/config reviewed |
| `packages/providers/llm/src/index.ts` | 13 | source/config reviewed |
| `packages/providers/llm/src/mock.ts` | 20 | source/config reviewed |
| `packages/providers/llm/src/ollama.ts` | 41 | source/config reviewed |
| `packages/providers/llm/src/provider.ts` | 5 | source/config reviewed |
| `packages/providers/llm/tsconfig.json` | 1 | source/config reviewed |
| `packages/providers/package.json` | 1 | source/config reviewed |
| `packages/providers/src/index.ts` | 12 | source/config reviewed |
| `packages/providers/tsconfig.json` | 1 | source/config reviewed |
| `packages/retrieval/package.json` | 1 | source/config reviewed |
| `packages/retrieval/src/index.ts` | 86 | source/config reviewed |
| `packages/retrieval/tsconfig.json` | 1 | source/config reviewed |
| `packages/shared/package.json` | 1 | source/config reviewed |
| `packages/shared/src/index.ts` | 24 | source/config reviewed |
| `packages/shared/tsconfig.json` | 1 | source/config reviewed |
| `packages/unicheatsheet-source/package.json` | 1 | source/config reviewed |
| `packages/unicheatsheet-source/src/catalog-builder.ts` | 35 | source/config reviewed |
| `packages/unicheatsheet-source/src/drive-url.ts` | 14 | source/config reviewed |
| `packages/unicheatsheet-source/src/index.ts` | 5 | source/config reviewed |
| `packages/unicheatsheet-source/src/normalizer.ts` | 24 | source/config reviewed |
| `packages/unicheatsheet-source/src/scanner.ts` | 57 | source/config reviewed |
| `packages/unicheatsheet-source/src/types.ts` | 46 | source/config reviewed |
| `packages/unicheatsheet-source/tsconfig.json` | 1 | source/config reviewed |
| `pnpm-lock.yaml` | 4051 | lockfile (structural/dependency review) |
| `pnpm-workspace.yaml` | 21 | source/config reviewed |
| `prisma/migrations/20260927000000_init/migration.sql` | 12 | source/config reviewed |
| `prisma/migrations/20260927010000_source_files/migration.sql` | 23 | source/config reviewed |
| `prisma/migrations/20260928000000_source_lifecycle/migration.sql` | 5 | source/config reviewed |
| `prisma/migrations/20260928010000_semantic_384/migration.sql` | 14 | source/config reviewed |
| `prisma/migrations/20260928020000_chat_memory/migration.sql` | 2 | source/config reviewed |
| `prisma/migrations/20260928030000_conversation_scope/migration.sql` | 2 | source/config reviewed |
| `prisma/migrations/20260928040000_conversation_owner/migration.sql` | 6 | source/config reviewed |
| `prisma/migrations/20260928050000_semantic_index/migration.sql` | 3 | source/config reviewed |
| `prisma/migrations/migration_lock.toml` | 1 | source/config reviewed |
| `prisma/schema.prisma` | 132 | source/config reviewed |
| `scripts/create_sample_pdf.py` | 70 | source/config reviewed |
| `scripts/drive-sync.ts` | 27 | source/config reviewed |
| `scripts/eval-retrieval.ts` | 18 | source/config reviewed |
| `scripts/index-catalog.ts` | 47 | source/config reviewed |
| `scripts/index-file.ts` | 28 | source/config reviewed |
| `scripts/ingest.ts` | 34 | source/config reviewed |
| `scripts/ocr_page.py` | 148 | source/config reviewed |
| `scripts/reconcile-catalog.ts` | 23 | source/config reviewed |
| `scripts/scan-drive-folders.ts` | 42 | source/config reviewed |
| `scripts/scan-unicheatsheet.ts` | 15 | source/config reviewed |
| `scripts/search.ts` | 21 | source/config reviewed |
| `scripts/seed.ts` | 8 | source/config reviewed |
| `scripts/sync-drive.ts` | 27 | source/config reviewed |
| `scripts/test-chat.ts` | 10 | source/config reviewed |
| `scripts/test-embeddings.ts` | 16 | source/config reviewed |
| `scripts/test-parse.ts` | 61 | source/config reviewed |
| `tests/access-context.integration.test.ts` | 81 | source/config reviewed |
| `tests/cache-sync.test.ts` | 64 | source/config reviewed |
| `tests/chat.integration.test.ts` | 121 | source/config reviewed |
| `tests/chat.test.ts` | 51 | source/config reviewed |
| `tests/document-processing.test.ts` | 64 | source/config reviewed |
| `tests/drive-lifecycle.integration.test.ts` | 44 | source/config reviewed |
| `tests/drive-sync.test.ts` | 54 | source/config reviewed |
| `tests/gemini.test.ts` | 23 | source/config reviewed |
| `tests/pipeline.test.ts` | 43 | source/config reviewed |
| `tests/retrieval.integration.test.ts` | 58 | source/config reviewed |
| `tsconfig.base.json` | 13 | source/config reviewed |
| `vitest.config.ts` | 3 | source/config reviewed |
| `vitest.integration.config.ts` | 9 | source/config reviewed |


---

## Final architectural target

```text
MAIN UNICHEATSHEET
existing login + payment + semester/specialization logic
        ↓ exact visible canonical course/resource IDs
short-lived signed AI session
        ↓
UNICHEATSHEET AI RUNTIME (Hostinger)
JWT verification
        ↓
resource/course/document scope intersection
        ↓
query embedding + hybrid authorized retrieval
        ↓
structured sources / PYQ analytics
        ↓
LLM generation with explicit provenance
        ↓
real SSE + validated final answer
        ↓
UniCheatSheet-native UI
Notes · PYQs · Solutions · Your Courses · Browse · Ask AI

INGESTION PC (offline/admin)
authoritative resource export + Drive/rclone
        ↓
parse / OCR / structure / chunk / embed
        ↓
external PostgreSQL + pgvector
```

The key product rule remains: **UniCheatSheet decides what the student owns; UniCheatSheet AI only reasons over that authorized resource set.**
