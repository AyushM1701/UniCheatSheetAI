# UniCheatSheet AI project audit — 29 September 2026

## Scope and current state

I reviewed the standalone Next.js playground, Fastify API, access context, Gemini and embedding providers, PDF/OCR and Drive ingestion, PostgreSQL/pgvector indexing, retrieval, grounded chat, deployment guide, and the local test corpus. I also checked the running playground at desktop and phone widths and exercised its course context and a deterministic PYQ query. The main UniCheatSheet.com code and its production Drive are not connected to this prototype, so this is an audit of the AI repository and its current local integration contract, not a production acceptance test.

The local corpus contains 10 PDFs from the temporary Drive folder catalog, plus local fixtures. Its provisional course IDs need mapping to the main website's canonical IDs. The standalone development context currently grants B.Tech Digital Electronics. The production design takes semester and allowed course IDs from a short-lived website-signed JWT; the AI API filters queries against those IDs. The main website does not need a new course detector or a large UI rewrite: it needs to issue the token from its existing login/course entitlement state and add an AI entry point. See [PROJECT_AND_WEBSITE_INTEGRATION.md](PROJECT_AND_WEBSITE_INTEGRATION.md) for the full handoff.

## Findings fixed in this audit

| Area | Finding | Change and verification |
| --- | --- | --- |
| Prompt security | Retrieved PDF text was placed inside a system message, giving malicious document instructions excessive authority. | The system instruction now treats documents as untrusted data; source passages are in the user message. Unit test checks the separation. |
| PYQ parsing | Exam pages with fewer than two recognizable question labels could disappear; short valid questions were discarded. | Such pages remain searchable, and short questions are retained. Parser tests cover both cases; the catalog was reindexed. |
| Gemini streaming | A final SSE event without a blank-line terminator could be lost. | The parser flushes the final buffer; a mocked stream test covers it. |
| Retrieval | One small lexical-first candidate query could exclude strong semantic results, and the vector index had been lost in a prior migration. | Independent lexical and semantic candidate pools are merged and filtered; an HNSW index migration was applied. Six local retrieval cases pass, including a negative query. |
| PYQ answers | A specific NAND-gate request could list an unrelated BCD question from the same paper. | PYQ selection now favors actual lexical matches and strong semantic matches, and warns when a question came from OCR. A local API check returned only the NAND question. |
| Indexing | `INDEX_LIMIT` repeatedly chose the first catalog records, which could starve later PDFs. Parser changes did not invalidate an earlier indexing key. | Limited runs now choose pending/stale files; the parser version is part of the indexing key. Two successive two-file runs advanced through different records in an isolated database; the current 10-file catalog has no pending records. |
| Access control | A signed token naming an unknown course ID could produce a phantom course entry. | The API rejects it with 401. Integration tests cover this and course restrictions. |
| Account switching | Two users with the same semester and course set could keep each other's chat visible in one browser tab after switching accounts. | `/v1/context` includes a non-raw account fingerprint; the playground clears its session when it changes. Integration tests confirm distinct fingerprints. |
| Chat persistence | An unsuccessful model request could leave an empty conversation in history. | New conversation creation and scope updates happen with the successful exchange save. Integration tests cover model failure. |
| Error handling | Temporary context fetch failures cleared chat, failed conversation loads could leave stale messages, and model overload was shown as a generic server error. | Transient context failures preserve state; failed conversation loads clear stale content; Gemini timeout/429/503 returns a retryable 503 message. |
| Browser access | The icon-only mobile New Chat control lacked an accessible name. | Added `aria-label`; checked browser accessibility tree. |
| Dependencies | `pnpm audit` reported three high severity findings in transitive `sharp` and `deepmerge-ts` versions. | Scoped pnpm overrides select patched versions. The audit now reports zero advisories, and tests, build, Prisma migrations, and retrieval still pass. Recheck compatibility when upgrading Transformers or Prisma. |

## Model and grounding assessment

- The configured Gemini model is `gemini-3.5-flash-lite` unless `GEMINI_MODEL` overrides it. The local API key was present and Google returned HTTP 200 for model metadata. Actual generation calls timed out during this audit, including a minimal prompt. A second Flash-Lite model returned HTTP 503 for high demand. Therefore **real Gemini answer quality and latency are not verified today**. The API now reports these failures as temporary unavailability. The provider is configurable rather than tied to the website.
- The local embedding model is all-MiniLM-L6-v2, a 384-dimensional CPU model. The retrieval evaluation checks top-result expectations across six queries; it is a smoke test, not a statistically meaningful relevance benchmark. Its English-focused tokenizer and the current PDF extraction path may miss abbreviations, formulas, tables, mixed languages, and handwriting.
- Academic answers require retrieved sources and recognized citation IDs. Unknown model-generated citation IDs and URLs are removed. **Citation validation checks identity, not entailment**: a model can still cite a real chunk for a claim that the chunk does not support. The prompt now gives source text lower authority, but prompt injection and hallucination still need adversarial and human evaluation before production.
- PYQ search and document counts are deterministic. OCR-derived PYQs warn students to inspect the original page for exact wording, symbols, and marks. Practice questions are labeled as generated, never as past-paper questions.

## RAG and data assessment

The pipeline is allowlisted catalog → targeted rclone `copyid` cache → PDF page extraction and optional OCR → question/page chunking → local embeddings → PostgreSQL/pgvector → scoped lexical/semantic retrieval → Gemini chat or deterministic PYQ/count response. Queries do not read Drive. Every retrieval request is restricted by allowed course IDs on the API side, and sources withdrawn by catalog reconciliation are excluded from search. The HNSW migration restores an approximate-nearest-neighbor path for a larger corpus.

The present lexical-first ranking among lexical candidates can favor common query words, and a fixed similarity threshold does not calibrate equally across every course or query. More work is needed on a larger, labeled production corpus: at least recall@k and precision@k by course and document type, answer faithfulness checks, OCR confidence review, and latency measurements. Include negative and cross-course leakage examples. The current six cases pass but cannot establish production accuracy. DOCX, PPTX, spreadsheets, and images are downloaded but not parsed for search. Scanned and handwritten notes need manual spot checks; successful OCR execution does not imply correct equations or names. Production Drive permissions and completeness are still unknown.

## UI and integration assessment

The course selector comes from the API context, not indexed document titles. The local test user sees only the granted B.Tech Digital Electronics course; a similarly named B.Sc. paper cannot create a duplicate menu item. The semester label comes from the context response. Desktop and narrow-phone viewport checks showed no horizontal overflow. A deterministic count question completed in the browser, and the icon-only mobile New Chat button now exposes a name to assistive technology.

Remaining UI work should be prioritized after the main-site connection is available: test keyboard and screen-reader use across the full conversation/source drawer flow; run actual phone and tablet device checks; show clearer source quality or OCR uncertainty in citations; and test session expiry, account switching, slow model responses, and network loss in a real browser session. The standalone playground has no login of its own; authentication and entitlement come from the website-signed token in production. Avoid deriving course access from PDF contents or from a browser-selected label.

The main website's required changes remain small and explicit: export canonical course/resource IDs, issue a short-lived signed AI token after existing access checks, add an Ask AI entry point, and provide a protected original-resource link route. The AI server needs the corresponding public key and main Drive rclone remote. This repository does not modify UniCheatSheet.com.

## Verification on this PC

| Check | Result |
| --- | --- |
| `pnpm test` | 21/21 unit tests pass |
| `pnpm test:integration` against `ucs_ai_review_20260928b` | 11/11 pass; normal prototype DB is guarded from these tests |
| `pnpm typecheck` and `pnpm build` | Pass |
| `pnpm db:migrate` against local prototype DB | Eight migrations applied; none pending |
| `pnpm eval:retrieval` | 6/6 local cases pass |
| `pnpm audit --audit-level high` | 0 known advisories at audit time |
| Live Gemini generation | Not confirmed; requests timed out or returned provider 503 |

## Remaining deployment risks and next checks

1. Connect the actual main website token issuer and canonical course IDs, then prove allow/deny behavior for real login, purchase, semester change, logout, and account switch. Test the protected original-resource route before showing an Open original action in production.
2. Connect the main Drive to rclone, review the complete production catalog, and run controlled indexing. Keep the temporary cache and manifest separate. Do not apply complete-catalog reconciliation to the current partial folder catalog.
3. Run a larger labeled retrieval and grounded-answer evaluation over real notes, PYQs, scans, handwriting, and misleading documents. Have a human inspect generated answers and cited passages, including when Gemini becomes available again.
4. Benchmark embedding, chat latency, memory, and concurrent requests on the target server. The current request limiter is process-local, so multiple API replicas need a shared limit store. Confirm the actual Hostinger plan and resource quota before choosing a deployment split.
5. Review privacy and retention for stored conversations and source excerpts. The current citation validator does not prove claim support; stronger sentence-level verification or human review is needed for high confidence answers.

This audit improves the working prototype without changing the main website. It does not establish that every issue is found or that production readiness is complete.
