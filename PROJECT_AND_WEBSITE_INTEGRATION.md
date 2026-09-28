# UniCheatSheet AI: project guide and main website integration

For the full implementation status — what is done, what is remaining, and the exact production checklist — see [UniCheatSheetAI_Deep_Audit_Implementation_Plan.md](UniCheatSheetAI_Deep_Audit_Implementation_Plan.md) and [LOCAL_READINESS.md](LOCAL_READINESS.md).

For the ingestion PC / Hostinger runtime split and secrets checklist, see [deploy/HOSTINGER_HANDOFF.md](deploy/HOSTINGER_HANDOFF.md).

## AI-side implementation status (29 September 2026)

The AI service has advanced substantially beyond an early prototype. The following are **confirmed implemented** on the AI side:

- **Real incremental LLM streaming** — tokens appear in the browser as the model generates them; the validated `done` event replaces provisional text on completion.
- **Provenance labels** — every answer carries `grounded | mixed | general | insufficient` computed from citation presence and intent.
- **JWKS multi-key rotation** — `AI_JWT_JWKS_FILE` is supported alongside single-key `AI_JWT_PUBLIC_KEY_FILE`.
- **HMAC-SHA-256 account key** — the `accountKey` returned in context is `HMAC(secret, userId)`, not a raw hash of the user ID.
- **RRF-style hybrid retrieval** — semantic and lexical candidates are merged using Reciprocal Rank Fusion scoring; lexical results no longer have unconditional priority.
- **`Resource` entity** — `prisma/schema.prisma` has a first-class `Resource` model with `ResourceType` and `ContentFormat` enums, `unit`, `sourceAssetId`, and `academicDocumentId`.
- **`ExamQuestion` structured records** — `questionNumber`, `subpart`, `marks`, `examType`, `year`, `session`, `topicTags`, `needsReview`; populated by `pnpm pyq:backfill`.
- **`resourceAvailability` in context** — `/v1/me/context` returns which resource types are indexed per allowed course.
- **`/v1/resources` and `/v1/resources/:id`** — resource browsing endpoints.
- **Conversation deletion and retention purge** — `DELETE /v1/conversations/:id`, `DELETE /v1/me/conversations`, `scripts/purge-old-conversations.ts`.
- **SSE hardening** — `X-Accel-Buffering: no`, 15-second keepalive heartbeat, backpressure check.
- **KaTeX math rendering** — installed and wired in `ChatMessage.tsx`.
- **26 tests passing** — `pnpm typecheck` → 0 errors; `pnpm test` → 26/26.

**Still pending on the main website side** (the AI service is ready and waiting):
- `POST /api/ai/session` — RS256 JWT issued from real website session + payment/course grants.
- Canonical production course and resource catalog export.
- Protected resource opening route `/resources/:resourceId/open`.

The implementation details later in this guide describe the full integration contract. The [deep audit plan](UniCheatSheetAI_Deep_Audit_Implementation_Plan.md) tracks item-by-item implementation status.

This document describes the code in this repository as of 28 September 2026 and the work required to connect it to the real UniCheatSheet website. The AI service is deliberately independent: it can run on a different computer from the website. The website remains responsible for accounts, payments, and course access. The AI service is responsible for finding indexed study material and generating answers grounded in that material.

## 1. Current state

| Area | Current state |
| --- | --- |
| Standalone AI interface | Next.js 15 playground at `http://localhost:3000`; dark/cyan UniCheatSheet-styled chat UI. |
| AI API | Fastify at `http://127.0.0.1:4000`; retrieval, resource browsing, chat/streaming, conversation history, PYQ analytics, source details, health routes. |
| Storage | PostgreSQL with pgvector: `Course`, `Resource`, `AcademicDocument`, `DocumentChunk`, `ExamQuestion`, `Conversation`, `Message`, `SourceFile`, `IngestionRun`. |
| AI generation | Real incremental Gemini streaming; retry/backoff on 429/5xx. Mock and Ollama providers available. |
| Provenance | Every answer carries `grounded/mixed/general/insufficient` computed at response time. |
| Access control | `dev-context.json` dev mode + JWKS-capable RS256 JWT verifier (single key or JWKS file). HMAC account key. Real website **not yet** issuing JWTs. |
| Resources | `Resource` model with enums, resource-browsing API, `resourceId` in citations. 112 structured exam question records. |
| Drive | Temporary rclone remote + 10 cached catalog PDFs. Main Drive **not** connected. |
| Main website | Resource cards at `href="#"`. No working login/payment backend found in inspected checkout. Deployed website may differ. |
| Public deployment | `deploy/Caddyfile.example` and `deploy/cloudflared.example.yml` exist. Public hostname not configured. |
| Tests | 26 tests pass; typecheck: 0 errors. |

The standalone playground is a development interface. Its API client does not yet obtain or attach a website JWT; it is not a ready production sign-in experience.

## 2. Architecture and ownership

```text
Student browser
  ├── Main UniCheatSheet website
  │     ├── login/session and payment records
  │     ├── course entitlement calculation
  │     └── server-only AI token issuer (to add)
  │
  └── HTTPS AI API (separate computer is fine)
        ├── verifies short-lived website-signed token
        ├── restricts every query to token course IDs
        ├── retrieves indexed passages from PostgreSQL/pgvector
        ├── calls Gemini for grounded chat
        └── stores user-scoped conversation history

Background indexing on AI computer:
website source/catalog → Drive file IDs → rclone targeted copy → PDF text
→ chunks → local embeddings → PostgreSQL/pgvector
```

The browser sends questions to the AI API. It does not send Drive files or Gemini credentials. The AI computer holds its own database, cached PDFs, embedding model, and Gemini key. Google Drive is used during sync and indexing, not during each chat request.

### Repository map

| Path | Purpose |
| --- | --- |
| `apps/api` | Fastify HTTP API and request authentication. |
| `apps/playground` | Standalone Next.js chat interface and same-origin API proxy. |
| `packages/ai-core` | Chat orchestration, intent routing, citations, and model adapters. |
| `packages/retrieval`, `packages/embeddings` | Semantic search and local 384-dimensional embeddings. |
| `packages/document-processing`, `packages/ingestion`, `packages/indexing` | PDF extraction, chunking, and persistence. |
| `packages/drive-sync`, `packages/unicheatsheet-source` | Targeted Drive download and website link scanning. |
| `prisma` | Database schema and migrations. |
| `catalog` | Course mapping, local fixtures, temporary Drive resources, and generated catalogs. |
| `scripts` | Commands for scanning, sync, parsing, indexing, search, and chat checks. |
| `deploy` | Example Caddy and Cloudflare Tunnel configurations. |
| `data` | Ignored local file cache, manifests, models, processing artifacts, and supplied PDFs. |

## 3. How study material reaches the chatbot

1. **Catalog the website.** `pnpm scan:resources` reads `sem*/lecture.html`, `pyqs.html`, and `solutions.html` from `UNICHEATSHEET_SOURCE_DIR`. It extracts Google Drive file IDs, resource titles/types, and course context into `catalog/resources.raw.json` and `catalog/resources.json`. `catalog/courses.json` provides canonical course IDs and aliases. Ambiguous course matches require manual review; they are not guessed.
2. **Sync selected files.** `pnpm sync:drive` reads `DRIVE_CATALOG_PATH` and asks rclone for each file by ID through `rclone backend copyid`. It does not mirror the whole Drive. Files are cached under `data/drive-cache/sem<semester>/<course>/<type>/`; a manifest records hashes and download metadata. `DRIVE_LIMIT` and `DRIVE_COURSE_ID` control a run.
3. **Extract and index.** `pnpm test:parse "<pdf>"` checks page extraction without a database. `pnpm index:file "<pdf>"` or the ingestion scripts produce page-linked chunks, compute local MiniLM embeddings, and store them in pgvector. PDF is the implemented parser. Scanned image PDFs need OCR, and Office files need additional parsers.
4. **Answer questions.** Retrieval filters by the student's allowed course IDs, then ranks matching chunks by cosine similarity. Chat passes selected passages to Gemini, validates citation IDs against actual retrieved sources, and returns an answer with page-linked citations. The `done` event is the authoritative result of a streamed answer. When the index has insufficient evidence, the engine reports that limitation.

The scanner currently finds zero links in the local website checkout because its cards use `href="#"`. The local smoke test instead uses `catalog/temporary-drive-resources.json` with three verified PDFs from the temporary Drive and synthetic/local DBMS fixtures. This does not represent the full production corpus. If the main site stores resource links outside HTML, adapt the scanner to that authoritative data source instead of scraping rendered placeholders.

### Switching to the production website and Drive

1. Obtain the actual deployed website's source or its authoritative resource catalog. Make each resource identifiable by a stable course ID, resource type, title, and Drive file ID. Replace placeholder links or export the data from its backend.
2. Set `UNICHEATSHEET_SOURCE_DIR` to that source checkout if the HTML scanner still applies. Run `pnpm scan:resources`; review `catalog/resources.json` and fix unresolved course aliases in `catalog/courses.json`.
3. Configure rclone for the main Drive on the AI computer. The remote must be able to read every cataloged file ID. Set `DRIVE_REMOTE=<main-remote>:` and `DRIVE_CATALOG_PATH=catalog/resources.json` in the AI `.env`. Use a separate `DRIVE_MANIFEST_PATH` for the main remote, so temporary and production sync state do not collide.
4. Run targeted sync with a small `DRIVE_LIMIT` first, parse/index the files, inspect search results and citations, then increase coverage. Keep source IDs and canonical course IDs stable during this switch.
5. Automate catalog refresh, sync, and indexing later with logging and failure alerts. A catalog entry alone is not searchable until its file has been parsed and indexed.

## 4. Run the current system locally

Requirements: Node.js 22+, pnpm, Docker Desktop, and rclone for Drive sync. Put secrets in the ignored root `.env`, starting from `.env.example`; never commit that file.

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev:all
```

Open `http://localhost:3000` for the playground. Check `http://127.0.0.1:4000/v1/health` for the API. Set `GEMINI_API_KEY` in `.env` for real answers. `LLM_PROVIDER=mock` exercises the chat flow without a model call. To populate real study material, follow the sync and index steps above. `pnpm typecheck`, `pnpm test`, and `pnpm test:integration` are the existing verification commands; integration tests need PostgreSQL.

Local access is read from `dev-context.json` when `ACCESS_CONTEXT_PROVIDER=dev`. This gives one simulated user, `dev-local`, an allowed-course list and optional current course. It is useful for development only. On public deployment, the API's startup guard requires JWT access mode and an explicit origin allowlist.

## 5. API contract for the website

The website should treat the API as a separate service, for example `https://ai-api.unicheatsheet.com`. The hostname is illustrative until DNS/TLS are configured. Relevant routes are:

| Route | Use |
| --- | --- |
| `GET /v1/health` | Public connectivity check. |
| `GET /v1/me/context` | User semester, allowed courses, `resourceAvailability` per course, and HMAC account key. |
| `GET /v1/courses` | Courses visible to this token. |
| `POST /v1/chat` | One complete answer with provenance label. |
| `POST /v1/chat/stream` | Stream `status`, `sources`, `token`, `done`, `error` SSE events (real incremental streaming). |
| `GET /v1/conversations` and `GET /v1/conversations/:id` | Visible conversation history. |
| `DELETE /v1/conversations/:id` | Delete a single conversation. |
| `DELETE /v1/me/conversations` | Delete all conversations for current user. |
| `GET /v1/resources?courseId=&type=&unit=` | Browse indexed resources for allowed courses. |
| `GET /v1/resources/:id` | Single resource metadata. |
| `GET /v1/pyqs/questions?courseId=&year=&examType=` | Structured exam question records. |
| `GET /v1/pyqs/repeated?courseId=` | Most-repeated question wording with counts. |
| `POST /v1/retrieve` | Direct semantic search (developer/admin use). |
| `GET /v1/chunks/:id`, `GET /v1/documents/:id` | Source inspection, subject to token access. |

All routes except health/version need access context. Send `Authorization: Bearer <short-lived-token>` on protected requests. A basic stream request is:

```http
POST /v1/chat/stream HTTP/1.1
Host: ai-api.unicheatsheet.com
Authorization: Bearer <website-issued-token>
Content-Type: application/json

{"message":"Explain normalization","scope":{"courseId":"dbms"}}
```

Omit `scope.courseId` for all courses granted by the token. Pass the returned `conversationId` on follow-up messages. An explicitly forbidden course is rejected. The AI checks course access again when reading a source or conversation. A token with changed course rights will hide older conversations whose course scope is no longer allowed.

The stream is an HTTP **POST** response containing SSE-formatted events; use `fetch()` and a stream reader. Native `EventSource` issues GET requests and is not a direct fit. The existing parser in `apps/playground/src/lib/api/ai-client.ts` is a starting point. Display token events progressively, but replace the displayed result with the validated `done` event. Surface an `error` event or premature close to the student.

## 6. Required changes in the main website

The inspected website checkout is static HTML/CSS/JS, with semester pages and a small `unichesheet/` Next.js scaffold. It does not show a working login, payment, or entitlement backend. Therefore the first production integration choice is **where the real server-side website session and course grants live**. If the deployed website already has them in another repository/service, implement the endpoint there. If it does not, add a real backend before issuing AI tokens. A static page cannot safely hold an RSA private key or decide paid access.

### A. Define canonical course grants

Use the same stable IDs as `catalog/courses.json` and indexed `Course.id` values, for example `dbms`. Maintain a mapping from the website's course records to those IDs. The website should calculate access from its authenticated user, enrollment, purchases/subscriptions, semester, and specialization **on the server**. Send only the resulting list of course IDs to the AI. A semester or specialization label by itself must not grant a course; students' access can differ within the same semester. Decide explicitly whether a student can access older semesters and encode that as course grants.

The B.Tech and B.Sc. Digital Electronics papers currently have separate provisional course IDs (`digital-electronics` and `digital-electronics-bsc`). The local development user is granted only the B.Tech ID, so the selector shows one Digital Electronics entry. Keep those source collections separate unless the authoritative website catalog says they are the same entitlement. The menu reads the signed `allowedCourses` context; it does not infer courses by scanning PDF titles or indexed content.

Store each resource's canonical course ID alongside its Drive ID in the main resource catalog. This same mapping drives both indexing and website authorization. Avoid using display names as security keys; they can change and may be duplicated.

### B. Add a server-only token endpoint

Implement an authenticated website route such as `POST /api/ai/session`. It must:

1. Read the existing website session from a secure cookie or equivalent and reject anonymous users.
2. Read current course entitlements from the website database/payment system. Never trust course IDs or payment status supplied by the browser.
3. Set `sub` to a stable opaque user ID, `semester` to the **authenticated student's current semester from the website's user/enrollment record**, `courses` to a nonempty array of canonical IDs, and optional `currentCourseId` to an ID within that array. Do not read semester from a page URL, browser input, or a fixed value in the token-issuing code.
4. Sign with **RS256** using a private key held only on the website server. Set the exact configured `iss` and `aud`, plus `iat` and `exp` no more than 15 minutes apart. Return the token over HTTPS with `Cache-Control: no-store`.
5. Return an access-denied response if the student has no eligible courses. The current AI token schema requires at least one course.

Example claims (illustrative values):

```json
{
  "iss": "https://unicheatsheet.com",
  "aud": "unicheatsheet-ai",
  "sub": "user_opaque_123",
  "semester": 3,
  "courses": ["dbms", "daa"],
  "currentCourseId": "dbms",
  "iat": 1790575000,
  "exp": 1790575900
}
```

The `3` above is only an example for one student. A different student's token must contain that student's own semester. The AI API verifies the signed token and returns its semester from `GET /v1/me/context`; the AI frontend renders that response. The context response also includes `accountKey`, a SHA-256 fingerprint of the opaque `sub`, so the frontend clears conversation state when two accounts with identical course access use the same tab. Do not display this value as a student identifier. `dev-context.json` supplies a mock semester only while running the disconnected local prototype.

The website keeps the private key; the AI server receives only the corresponding public key via `AI_JWT_PUBLIC_KEY_FILE` or `AI_JWT_PUBLIC_KEY`. The AI verifier checks signature, issuer, audience, lifetime, and claim shape. Rotate keys using a coordinated deployment; the current AI verifier accepts one configured public key, so seamless overlapping rotation would require code support. A revoked purchase can remain represented in an already issued token until it expires (at most 15 minutes); shorten TTL if the business requirement is stricter.

### C. Add the AI entry point and browser integration

Add an “Ask AI” action to the main navigation and, optionally, to each course/resource card. On a course page, open AI with that canonical course ID selected; on a general page, use all allowed courses. Show the course list from `GET /v1/me/context`, not from a hardcoded HTML list. The browser flow is:

```text
Load AI view → POST website /api/ai/session (website cookie)
→ receive short-lived token → GET AI /v1/me/context
→ POST AI /v1/chat/stream with Bearer token
→ render answer, citations, and conversation ID
```

Keep the AI token in memory. On a 401, request a fresh token from the website and retry only where it is safe to do so; show login/access UI if the website session has expired. Do not put tokens in query strings, local storage, HTML source, or analytics events. The website's own session cookie remains scoped to the website; the AI API receives the Bearer token. If direct browser requests are undesirable, add a **website server proxy** that attaches a token and forwards only approved AI routes; that is a separate implementation choice and must still enforce the website session.

The existing standalone playground can supply UI components and its client now accepts a `tokenProvider` adapter, but no website token issuer is connected. Call `configureAiClient` when the authenticated website session becomes available and again after a login, logout, or enrollment change. The frontend reloads the signed academic context and clears stale chat state when that configuration changes; it also refreshes the semester when the tab regains focus. If the final interface is hosted at a separate `ai.` subdomain, add a secure login bootstrap from the main website (for example, a one-time server-side exchange) rather than putting a JWT in the navigation URL. If the AI UI is embedded in the main website, adapt the playground components there and call the AI API with the token from `/api/ai/session`. The main website is not modified by this repository today.

### D. Make citations open authorized resources

The AI currently returns document/chunk metadata and page references. In local dev mode it may return the original Drive URL. JWT mode omits structured Drive URL fields because the site's protected resource flow is not yet connected. For production, add a stable `resourceId`/Drive ID mapping in the catalog and a website endpoint such as `GET /resources/:resourceId/open` that checks the current website session and that resource's course grant before redirecting to or serving the resource. Extend AI citations to provide that authorized website URL or a resource ID that the frontend can resolve. Verify this end to end before enabling an “Open original” link. Also inspect indexed PDF text for embedded URLs; hiding API URL fields does not remove URLs written inside document content.

### E. Replace placeholders in the main resource catalog

The current `sem*/lecture.html`, `pyqs.html`, and `solutions.html` pages largely contain `href="#"` resource cards. Supply actual resource records/links in the authoritative main website source or backend so the scanner can build a production catalog. If access is paid, do not simply expose private Drive links in static HTML. The public page can display titles; the authenticated resource endpoint should perform the access check. Provide the AI indexing process with an export of the same resource IDs and course mappings. This avoids the website and AI silently disagreeing about who owns a document.

## 7. Publishing the AI API on another computer

Run PostgreSQL, the AI API, embedding cache, and scheduled indexing on the AI computer. Keep Fastify bound to `127.0.0.1:4000` and publish an HTTPS hostname through a reverse proxy or a named tunnel; examples are in `deploy/Caddyfile.example` and `deploy/cloudflared.example.yml`. Configure DNS/TLS and the proxy on that computer. Do not expose the raw port directly to the internet.

Example production-oriented AI environment values (replace placeholders):

```dotenv
NODE_ENV=production
AI_PUBLIC_MODE=true
ACCESS_CONTEXT_PROVIDER=jwt
AI_JWT_PUBLIC_KEY_FILE=/secure/path/website-ai-public.pem
AI_JWT_ISSUER=https://unicheatsheet.com
AI_JWT_AUDIENCE=unicheatsheet-ai
AI_CORS_ORIGINS=https://unicheatsheet.com,https://www.unicheatsheet.com
GEMINI_API_KEY=<set-on-AI-server-only>
DRIVE_REMOTE=<main-remote>:
DRIVE_CATALOG_PATH=catalog/resources.json
DRIVE_MANIFEST_PATH=data/manifests/main-drive-sync.json
```

`AI_CORS_ORIGINS` must contain exact website origins used by browser calls; `*` is rejected. CORS is a browser rule, not authentication: the JWT remains mandatory. Add the AI UI subdomain only if it will make direct cross-origin API calls. Keep database and model credentials on the AI computer. The website needs its signing private key but not the Gemini key or the AI database password. Keep the AI API and website clocks synchronized because JWT expiry depends on time.

The API's current JWT verifier is implemented, but production still needs the website issuer, real source catalog, public hosting, monitoring, rate limits/abuse controls, backup and restore practice, and a citation-opening policy. Establish those before announcing the feature publicly.

## 8. Integration acceptance checks

Run these against a staging website, real signed tokens, and a small indexed main-Drive sample:

1. A logged-in student with a DBMS grant sees DBMS in `/v1/me/context`, can ask DBMS questions, and gets page-linked citations.
2. The same student cannot retrieve a course absent from their token, including by editing a request body, opening a chunk URL, or replaying a conversation ID.
3. An anonymous request, altered signature, wrong issuer/audience, and expired token all fail. The browser renews a token after expiry without losing the draft question.
4. Student A cannot list or read Student B's conversations. Removing a grant hides conversation history that used the removed course.
5. The main website's protected resource link checks the current session and grant before opening a citation; a revoked student cannot use an old link.
6. Streaming handles `status`, `sources`, `token`, `done`, errors, and an interrupted connection. The final displayed answer matches `done`.
7. Exact allowed website origins work over HTTPS; an unrelated origin is rejected. The Gemini key, signing key, database credentials, and raw Drive URLs are absent from browser responses.
8. The main catalog and AI index contain the same course and resource IDs; a newly added file becomes searchable after sync/index, and an intentionally removed file is handled according to an explicit removal policy.
9. Test on the expected student load with monitoring for latency, indexing failures, Gemini errors/costs, and database growth. Back up PostgreSQL and verify restoration.

## 9. Recommended work order

1. Identify the real production website backend and authoritative resource database. Define canonical user IDs, course IDs, and grant rules there.
2. Export real resource IDs/course mappings, connect the main Drive rclone remote on the AI computer, and index a small representative sample.
3. Implement the website's server-side RS256 token endpoint. Switch a staging AI API to JWT mode and test it with real session-derived grants.
4. Add the AI entry point and token-aware chat client to the main website, or implement the separate AI subdomain bootstrap. Reuse the current playground UI where helpful.
5. Add protected citation opening, then complete security, performance, failure, and access-revocation checks.
6. Publish the API hostname and roll out to a small group before general release.

The existing [README](README.md) contains command-level details. Configuration templates are in [.env.example](.env.example), [Caddyfile.example](deploy/Caddyfile.example), and [cloudflared.example.yml](deploy/cloudflared.example.yml).

## 10. Prototype-to-main migration: every setting to review

There are **two machines/roles** in the intended setup. The main website's PC/server runs the website, its user/payment system, and the private JWT signing key. The AI PC/server runs this repository, PostgreSQL/pgvector, rclone, its Drive file cache, the embedding model, Gemini calls, and the **public** JWT verification key. Either role can later move to another host; use hostnames and environment variables rather than hardcoded LAN IPs or prototype file paths. The local website source path is needed only by an HTML scanner and is not needed for live chat.

### What to copy, replace, and leave behind

| Prototype item | Main setup action | Where it belongs |
| --- | --- | --- |
| This repository's source and lockfile | Deploy a clean checkout and run `pnpm install --frozen-lockfile`, Prisma generation/migrations, and the API process. | AI PC |
| Root `.env` | Create a **new** production `.env` from `.env.example`; do not copy prototype secrets as the production configuration. Restrict file access. | AI PC |
| `DATABASE_URL` and Compose `ucs/ucs` credentials | Provision persistent pgvector PostgreSQL with a strong unique password and backups. Change `DATABASE_URL` accordingly. The checked-in Compose file publishes port 5432 and uses development credentials; change that setup before any public use. | AI PC |
| `GEMINI_API_KEY` | Configure a production Gemini key in the AI server's secret environment, with quota/billing and failure monitoring. Do not place it on the website or in browser code. Rotate the prototype key if it has been shared outside its intended environment. | AI PC |
| `AI_JWT_PUBLIC_KEY_FILE`, `AI_JWT_ISSUER`, `AI_JWT_AUDIENCE` | Create a new RS256 key pair for this integration. Install only the public PEM on the AI PC; configure issuer/audience to exactly match the website's signed tokens. | Public key: AI PC; private key: website server |
| `ACCESS_CONTEXT_PROVIDER=dev`, `dev-context.json`, `AI_PUBLIC_MODE=false` | Set `ACCESS_CONTEXT_PROVIDER=jwt`, `AI_PUBLIC_MODE=true`, and production mode. `dev-context.json` is a local simulation, not a production user database. | AI PC |
| `UNICHEATSHEET_SOURCE_DIR` | Point to an accessible copy of the **main** website source if it contains real links. If the source stays on the other PC, publish a versioned resource export and copy it to the AI PC or add an authenticated catalog adapter; do not assume a Windows path from this prototype exists remotely. | AI PC indexing job |
| `catalog/courses.json` | Replace/extend the 3-course prototype map with the main site's canonical course IDs and aliases. The website entitlement IDs, resource catalog IDs, and AI database IDs must match exactly. | Both systems' shared contract |
| `catalog/temporary-drive-resources.json`, `catalog/local-resources.json`, sample PDFs | Keep as test fixtures only. Use the production export in `catalog/resources.json` or another explicitly selected catalog file. | AI PC |
| Temporary rclone remote (`unicheatsheetAI:`) | Configure a new remote authorized for the **main Drive**; set `DRIVE_REMOTE` to its exact name plus `:`. Validate access to sample file IDs before a bulk run. | AI PC |
| `DRIVE_CATALOG_PATH`, `DRIVE_MANIFEST_PATH`, `DRIVE_CACHE_DIR`, `DRIVE_TEMP_DIR` | Point to production catalog and persistent writable storage. Use a fresh manifest for the main Drive. Ensure space, backups as needed, and permissions; avoid moving temporary cache data blindly into production. | AI PC |
| `DRIVE_LIMIT=3`, `DRIVE_COURSE_ID` | Raise the limit deliberately when ready; clear `DRIVE_COURSE_ID` for all courses. Start with a small course/sample batch and inspect output. | AI PC |
| `HOST=127.0.0.1`, `PORT=4000`, deploy examples | Keep loopback binding if a proxy/tunnel runs on the AI PC. Replace example hostname, tunnel UUID/credentials path or Caddy site name, and DNS records with the real HTTPS API address. | AI PC and DNS/proxy |
| `AI_CORS_ORIGINS` | List every exact production website origin that makes browser requests. Include staging separately when testing; remove unused origins afterward. | AI PC |
| `apps/playground/.env.local` `AI_API_URL` | If deploying the standalone playground, point its server-side proxy to the real AI API URL and add JWT acquisition/forwarding to its client. If the main site hosts the UI, this setting is unnecessary there. | UI host |
| Hardcoded/example `ai-api.unicheatsheet.com` | Replace with the real hostname everywhere: DNS, TLS/proxy, website API base URL, CORS, monitoring, and deployment docs. | Both systems |

Other `.env.example` settings are operational tuning, not website credentials: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `HF_MODEL_CACHE_DIR`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `RETRIEVAL_MIN_SCORE`, `GEMINI_MODEL`, `LOG_LEVEL`, `RCLONE_BINARY`, `DRIVE_REFRESH_HOURS`, and `PROCESSING_DIR`. Review them on the main corpus. **Keep embedding model/dimension compatible with stored vectors**; changing them requires re-indexing. `OLLAMA_BASE_URL` and `OLLAMA_MODEL` matter only if switching `LLM_PROVIDER` from Gemini to Ollama. `DEV_ACCESS_CONTEXT_FILE` should not be used in JWT mode.

### Configure rclone for the main Drive on the AI PC

Rclone configuration is **per machine/user**, not stored in this repository. The main website PC does not need rclone unless it independently manages Drive. On the AI PC, install rclone and run `rclone config` interactively under the same operating-system account that will run the sync job. Create a Google Drive remote, for example `unicheatsheetMain`. Authorize an account or service identity that can read the actual resource files, including items in shared Drives if relevant. If authentication must be completed on another PC, use rclone's remote/headless authorization workflow and transfer only the resulting configuration to the AI service account through a secure channel. Restrict access to the rclone config because it contains refresh credentials; do not commit or paste it into chat.

Then validate the remote and one **known** production file ID before indexing:

```powershell
rclone version
rclone listremotes
rclone config file
# Replace the ID with a real file ID from the main catalog:
New-Item -ItemType Directory -Force .\data\temp\drive-smoke
rclone backend copyid unicheatsheetMain: MAIN_DRIVE_FILE_ID .\data\temp\drive-smoke\
```

`rclone listremotes` must show `unicheatsheetMain:`. The `copyid` check must return the actual PDF, not a Drive HTML permission page or unrelated file. Set `DRIVE_REMOTE=unicheatsheetMain:` in the AI `.env`; this code expects the remote root ending in a colon. If the main Drive is a shared Drive or links belong to several accounts, configure access so all cataloged IDs are readable, or split the catalog/sync strategy accordingly. Avoid `rclone sync` of the entire Drive: this project deliberately downloads only cataloged IDs. The production website does **not** need to publish its Drive credentials to the browser.

Set `DRIVE_CATALOG_PATH` to the main resource export and `DRIVE_MANIFEST_PATH` to a new manifest path. `DRIVE_LIMIT` controls each cache run, so a successful small run does not mean the full catalog is indexed. After `pnpm sync:drive`, run parse/index commands for the downloaded PDFs (or build/schedule a batch index job); cache-only sync alone does not make them searchable. Record failures and repeat only after permissions/file IDs are corrected. Non-PDF files can be cached but cannot yet be parsed by the current PDF-only processor.

### Keys, secrets, and URLs: creation and placement

| Value | Create or obtain from | Website server | AI server | Browser |
| --- | --- | --- | --- | --- |
| Main user session/payment credentials | Existing production website system | Yes | No | Session cookie only |
| RS256 signing **private** key | New key pair for this integration | Yes | No | No |
| RS256 verification **public** key | Same key pair | Optional | Yes | No |
| `AI_JWT_ISSUER` and `AI_JWT_AUDIENCE` | Agreed constant strings | Sign into token | Verify token | No need |
| Gemini API key | Gemini account/project used for production | No | Yes | No |
| Main Drive rclone OAuth/service credentials | Main Drive owner/admin | No need | Yes | No |
| PostgreSQL password | New production database credential | No | Yes | No |
| HTTPS AI API hostname | DNS and reverse proxy/tunnel | Website uses it | API is published there | Browser may call it |
| Short-lived AI JWT | Website session endpoint after grant check | Signs/returns | Verifies | Holds in memory temporarily |

Never use the example JWT payload as a credential; it only illustrates claim names. Do not copy the prototype `.env`, rclone config, database password, or development JWT keys into public source control. Confirm which Google account owns the real Drive and who can authorize access before moving the indexing job.

### Exact cutover sequence across the two PCs

1. **Main website owner:** identify the real deployed code/database, login and payment authority, and canonical course/resource IDs. Export a small resource catalog with actual main-Drive file IDs. Decide the production AI hostname.
2. **AI PC:** deploy the repository and persistent PostgreSQL; create its production `.env`, Gemini key, rclone main-Drive remote, file cache locations, and TLS proxy/tunnel. Keep the API private until JWT mode is configured.
3. **Both:** create RS256 key pair and agree on issuer/audience. Put private key only on website server, public key only on AI server. Implement the website session endpoint and verify it derives grants from current server-side data.
4. **AI PC:** scan/import the main catalog, sync a few files, parse/index, run sample searches, and verify course IDs, page numbers, and citations. Expand to the full eligible corpus in batches.
5. **Main website:** add AI navigation/course actions and a token-aware UI. Set the API base URL to the HTTPS hostname. Implement protected citation opening and access checks.
6. **Both:** test valid/invalid access, revoked grants, token renewal, streaming, Drive permission failures, and cross-origin requests in staging. Remove any temporary dev access mode before public traffic.
7. **Operations:** schedule catalog/sync/index jobs, enable logs/alerts and backups, monitor Gemini usage, and document how to rotate the signing key, Gemini key, rclone credentials, and database password.

Until those steps are finished, this installation remains a working prototype with temporary Drive content. Moving the website to another PC does not automatically connect its accounts or Drive; the signed-token contract and catalog/Drive migration are the connection points.
