# UniCheatSheet AI

## Current local prototype

The three user-supplied Drive folders are configured in [catalog/drive-folders.json](catalog/drive-folders.json). Their 10 PDFs are listed in [catalog/folder-resources.json](catalog/folder-resources.json) and cached locally. `catalog/courses.json` contains **provisional AI-side IDs** for Architecture and Digital Electronics; map these to the main website's real course IDs before production. The main Drive and website backend are still separate.

On this PC, the PDF parser can OCR image-only pages when `OCR_ENABLED=true`, `PDFTOPPM_BINARY`, and `OCR_BINARY` point to installed Poppler and Tesseract tools. The 2024 Digital Electronics paper was verified locally: 2 extractable pages and 11 question chunks. After Docker Desktop is running, execute:

```sh
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm index:catalog catalog/folder-resources.json
pnpm eval:retrieval
pnpm dev:all
```

To rescan and refresh the temporary folders, run `pnpm scan:folders`, then `pnpm sync:drive catalog/folder-resources.json`. `DRIVE_LIMIT` controls how many files are checked per run; repeated runs advance through the catalog. `DRIVE_REFRESH_HOURS` controls download freshness. `pnpm index:catalog` indexes cached PDFs into PostgreSQL, using `INDEX_LIMIT` if set. Indexing is a separate step from caching. Run integration tests only with a separate database whose name contains `_test` or `_review`; they intentionally refuse the normal prototype database.

For an **authoritative complete** main-Drive catalog, `pnpm reconcile:catalog <catalog>` previews currently active AI sources missing from that catalog. Review the preview, set `DRIVE_CATALOG_COMPLETE=true`, then run `pnpm reconcile:catalog <catalog> --apply` to withdraw them from search. Do not apply this to the current 10-file folder catalog: it is only a partial temporary corpus and would hide other valid prototype sources.

The AI API has `GET /v1/ready` for database readiness and `GET /v1/coverage` for allowed-course document counts. `configureAiClient({ tokenProvider, apiBaseUrl })` in the playground client is the integration hook for the future website's short-lived JWT. The website still needs its token endpoint and protected original-resource link flow; details are in [PROJECT_AND_WEBSITE_INTEGRATION.md](PROJECT_AND_WEBSITE_INTEGRATION.md).

Standalone academic retrieval and grounded chat service. A read-only scanner catalogs Google Drive links from a separate UniCheatSheet website checkout. An ID-based rclone adapter copies selected PDFs into a gitignored cache. Ingestion extracts page text, chunks it, stores vectors in pgvector, and serves ranked chunks through Fastify. Chat uses the indexed chunks and Gemini; queries never contact Drive.

## Standalone playground

The Next.js playground runs at [http://localhost:3000](http://localhost:3000), separately from the API at `http://127.0.0.1:4000`. Start PostgreSQL, apply migrations, and run both services:

```sh
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev:all
```

Set `GEMINI_API_KEY` in the ignored root `.env` file before chatting. The browser calls the playground's same-origin `/api/ai` proxy, which forwards only supported routes to the API; Gemini credentials stay on the backend. The proxy defaults to `http://127.0.0.1:4000`. To change that later, set `AI_API_URL` in `apps/playground/.env.local` using [apps/playground/.env.example](apps/playground/.env.example) as a template. The main UniCheatSheet website is untouched.

The welcome page has a course selector and suggestions when indexed material is available. Sending a question opens a conversation with status updates; the validated answer is sent after generation. Source chips open the indexed passage and, in local development mode, its original Drive link where available. Conversations and their course scope reopen from the history menu. The layout adapts to phones. The playground has no login, uploads, or LMS sources yet.

## Separate HTTPS AI server

The AI API can run on another PC or VPS while PostgreSQL, the document index, embeddings, and Drive cache stay with it. Keep Fastify bound to `127.0.0.1:4000` and publish it through a TLS reverse proxy or a named tunnel. [Caddy example](deploy/Caddyfile.example) and [Cloudflare Tunnel example](deploy/cloudflared.example.yml) are templates; they do not create DNS records or publish this local machine. Cloudflare setup still needs your account, a named tunnel, its credentials, and control of the hostname. The main website remains separate and unchanged.

Public startup requires `NODE_ENV=production` or `AI_PUBLIC_MODE=true`, `ACCESS_CONTEXT_PROVIDER=jwt`, and explicit `AI_CORS_ORIGINS` such as `https://unicheatsheet.com,https://www.unicheatsheet.com,https://ai.unicheatsheet.com`. Origins must match exactly; `*` is rejected. Set `AI_JWT_PUBLIC_KEY_FILE` to the AI server's copy of the site's RSA public key, plus `AI_JWT_ISSUER` and `AI_JWT_AUDIENCE`. The signing private key stays only on the main website. The API accepts RS256 tokens with matching issuer/audience, subject, issued-at time, expiry, `semester`, and nonempty `courses`; token lifetime must not exceed 15 minutes. `currentCourseId`, if present, must be one of `courses`. JWT mode omits structured original Drive URL fields from API results and citations; inspect source text before publishing paid material, since a PDF could itself contain a link.

The main website should mint a token only after its existing login and payment checks determine visible course IDs. A signed payload has this shape:

```json
{
  "iss": "https://unicheatsheet.com",
  "aud": "unicheatsheet-ai",
  "sub": "opaque-user-id",
  "semester": 4,
  "courses": ["flat", "cryptography", "ooad"],
  "currentCourseId": "cryptography",
  "iat": 1790575000,
  "exp": 1790575900
}
```

The browser sends `Authorization: Bearer <token>` to `GET /v1/me/context` and to `POST /v1/chat/stream` with a body such as `{ "message": "Explain AES", "scope": { "courseId": "cryptography" } }`. Omit `scope.courseId` for all allowed courses. The context response supplies the course selector; no payment details cross to the AI. Conversation history is tied to `sub` and its used course IDs, so a later loss of course access hides previously saved material. The health endpoint stays public for connectivity checks. The standalone playground continues using the development provider on localhost; the main website's token issuance and frontend handoff have not yet been connected.

### Development course access

The API reads [dev-context.json](dev-context.json) through `AccessContextProvider`. Edit `semester`, `allowedCourses`, and optional `currentCourseId` to simulate the courses the main website grants a student. IDs must match indexed course IDs. The selector is populated from `GET /v1/context`; an absent `currentCourseId` starts with All courses. The API applies the allowed IDs to chat retrieval, direct retrieval, document counts, courses, and source details, so editing a browser request cannot widen the search. Set `DEV_ACCESS_CONTEXT_FILE` to another path, resolved from this project root, to use a different context file.

This JSON provider represents one local development user. It is not a production authentication mechanism. The JWT provider described above is the request-specific production option; the main site still needs to issue its tokens after its existing access checks. The AI does not calculate access from semester or specialization. The main website remains unchanged for now.

## Run locally

Requires Node 22+, pnpm, Docker Desktop, and rclone for Drive sync.

```sh
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm ingest # synthetic sample only
pnpm sync:drive
pnpm index:file "data/drive-cache/sem2/evs-living-lab/lecture/class-activities-and-group-project--1xpxD6gF8IpERg0jwNQijPpXSy5-rr8DA.pdf"
pnpm search:ai "sustainable water management" --course evs-living-lab
pnpm dev
```

PowerShell: `Copy-Item .env.example .env` instead of `cp` if desired.

```sh
curl http://localhost:4000/v1/health
curl -X POST http://localhost:4000/v1/retrieve -H "Content-Type: application/json" -d '{"query":"normalization","courseId":"dbms"}'
```

The API also exposes `GET /version`, `GET /v1/courses`, and `GET /v1/documents/:id`. The document endpoint exposes extracted chunks for source inspection. Search results include the document title, page range, source URL when available, content, and cosine similarity. `POST /v1/retrieve` accepts optional `courseId`, `semester`, `type`, `resourceTypes`, `source`, and `limit` filters. Use `pnpm search:ai` for local CLI search; `pnpm run search` also works (`pnpm search` invokes pnpm's own command).

## Grounded chat

Set `GEMINI_API_KEY` in the ignored `.env` file. The default `LLM_PROVIDER=gemini` uses `GEMINI_MODEL=gemini-3.5-flash-lite`. The key is sent only to the Gemini API. To test orchestration without an external call, set `LLM_PROVIDER=mock`; it returns source excerpts and is not a generative model. `LLM_PROVIDER=ollama` is also supported with `OLLAMA_BASE_URL` and `OLLAMA_MODEL` when Ollama is installed. The [Gemini REST API](https://ai.google.dev/gemini-api/docs/generate-content/text-generation) is used for generation and streaming.

```sh
pnpm test:chat "Explain sustainable water management" evs-living-lab
```

`POST /v1/chat` accepts `{"message":"Explain normalization","conversationId":null,"scope":{"semester":3,"courseId":"dbms"}}`. It returns an answer, a conversation ID, citations with server-owned document/page metadata, and intent/retrieval metadata. Development mode also returns original Drive URLs where available; JWT mode hides them until the main site's protected resource flow is connected. Pass the returned conversation ID on follow-up calls. The database stores exchanges and sends only the most recent 10 messages to the model. `POST /v1/chat/stream` accepts the same body and sends SSE `status`, `sources`, `token`, and `done` events. The `done` event contains the authoritative validated answer and citations.

The router handles PYQ lookup as a search of indexed `pyq` documents, count questions as database queries, and explicit practice requests as generation from retrieved context. Other academic questions use up to six retrieved chunks. When no relevant chunks pass the score threshold, chat reports insufficient material without asking Gemini to invent an answer. Citation IDs are assigned before generation and mapped to stored source metadata afterward; unknown IDs and model-generated URLs are removed. The backend verifies citation identity and metadata, but cannot prove that every generated sentence follows from its cited passage.

The temporary Drive catalog includes EVS and Physics, and the new folder catalog adds Architecture, Digital Electronics, and Physics exam papers. The DBMS normalization fixture is synthetic and has no Drive URL; the locally supplied 97-page DBMS PDF also lacks a Drive URL. To get DBMS answers with real Drive links, add and index the actual DBMS Drive resource in the catalog. The prompt labels synthetic fixture material as sample content.

## Scan the website locally

The scanner needs only Node and a path to the website source. It does not connect to PostgreSQL, rclone, or the website server, and it does not modify the website checkout. Set this in the untracked `.env` file:

```env
UNICHEATSHEET_SOURCE_DIR=C:\Users\AYUSH\Downloads\UniCheatSheet-main\UniCheatSheet-main
```

Then run `pnpm scan:resources`. You can also pass a different checkout directly: `pnpm scan:resources "C:\path\to\UniCheatSheet"`. The command scans `sem*/lecture.html`, `pyqs.html`, and `solutions.html`, deduplicates by Drive file ID, and writes `catalog/resources.raw.json` and `catalog/resources.json` as JSON arrays. It uses `catalog/courses.json` for course names and aliases. Unmatched or ambiguous courses remain without a `courseId` in the normalized catalog for review; they are never assigned a guessed ID.

The current local website checkout has 12 semester pages but all resource cards use placeholder `href="#"` links. The scanner therefore reports zero Drive links and writes `[]` to both catalog files. This is a successful scan of that checkout, not a Drive connection failure. The verified user-provided EVS Living Lab link lives separately in `catalog/temporary-drive-resources.json` for the local ingestion smoke test. The sample PDF for `pnpm ingest` lives separately in `catalog/local-resources.json`.

## Switch to the main website and Drive later

Change `UNICHEATSHEET_SOURCE_DIR` to the main website checkout, run `pnpm scan:resources`, review unresolved resources, and add needed aliases to `catalog/courses.json`. Configure the main rclone remote, then set `DRIVE_REMOTE=<main-remote>:` and `DRIVE_CATALOG_PATH=catalog/resources.json` in `.env`. Set `DRIVE_COURSE_ID=` to include all courses or a specific ID to limit the run. No website code needs to be copied into this repository. The main website must contain real Drive file URLs; those IDs must be accessible through the configured main remote.

For the current temporary Drive test, `.env` points `DRIVE_CATALOG_PATH` at `catalog/temporary-drive-resources.json` and `DRIVE_REMOTE` at the temporary `unicheatsheetAI:` remote. The main Drive is not connected. Run `pnpm sync:drive` to cache only the selected files; this command does not need PostgreSQL or embeddings. It calls `rclone backend copyid` with each cataloged ID and never enumerates or mirrors the Drive. `DRIVE_LIMIT` caps files per run (default 3), and `DRIVE_COURSE_ID` optionally filters one course.

The cache command downloads sequentially to `data/temp`, keeps the file's original extension, and stores it under `data/drive-cache/sem<semester>/<course>/<type>/<title>--<Drive-ID>.<extension>`. The Drive ID prevents same-title collisions. `data/manifests/drive-sync.json` records the original filename, size, download time, and SHA-256 hash. An intact file is skipped until `DRIVE_REFRESH_HOURS` expires; a missing or corrupted file is downloaded again. If a course or title changes, the intact cached file moves to its new folder without a new download. Use a different `DRIVE_MANIFEST_PATH` when switching to the main remote to keep both manifests. The older temporary catalog contains three verified PDFs; the new allowlisted folder catalog contains 10.

`pnpm drive:sync` is the earlier PDF-only indexing command. It also writes to PostgreSQL and updates retrieval state; keep using `pnpm sync:drive` for this cache-only sprint. DOCX, PPTX, XLSX, and image downloads retain their extensions, but document parsing for those formats is later work.

## Parse and chunk cached PDFs

Run `pnpm test:parse "<cached PDF path>"` to extract text one page at a time, clean spacing lightly, create page-linked chunks, and write a JSON debugging artifact under `data/processing/`. This command needs neither PostgreSQL nor an embedding provider. It matches the path to `DRIVE_MANIFEST_PATH` and `DRIVE_CATALOG_PATH` to carry Drive ID, source URL, semester, course, resource type, and title into the artifact and chunks. Set `PROCESSING_DIR` to change the artifact folder.

```sh
pnpm test:parse "data/drive-cache/sem2/evs-living-lab/lecture/class-activities-and-group-project--1xpxD6gF8IpERg0jwNQijPpXSy5-rr8DA.pdf"
```

The command prints the first three chunks and `READY_FOR_EMBEDDING`. With `OCR_ENABLED=true` and the required binaries installed, low-text PDF pages are OCRed before chunking. A document with fewer than 50 recovered characters reports `OCR_REQUIRED`. PDF remains the only supported parser; DOCX and PPTX parsing are later work.

## Ingestion

`data/samples/dbms-normalization.pdf` is a synthetic four page test fixture and the only sample tracked in Git. The previously supplied 97 page DBMS PDF remains available locally at `data/samples/dbms/notes.pdf` but is ignored by Git. Manual import remains available for debugging:

```sh
pnpm ingest data/samples/dbms/notes.pdf --course dbms --title "DBMS Notes" --source unicheatsheet
```

The path command defaults to course `dbms`, type `lecture`, and source `local`. You can also add a local PDF to `catalog/local-resources.json` and run `pnpm ingest [resource-id]`. Reingestion skips unchanged files only when the PDF checksum, embedding provider, and chunk settings all match. PDFs must be local and at most 25 MB; scanned pages need the configured OCR tools.

`CHUNK_SIZE` and `CHUNK_OVERLAP` are approximate token counts, initially 600 and 100. Final chunks are checked against the embedding model's 512-token window and split when needed. `EMBEDDING_PROVIDER=local` runs the all-MiniLM-L6-v2 ONNX model on the local CPU with 384-dimensional normalized vectors. The first run downloads the model into the ignored `data/models/huggingface` cache; subsequent indexing and searches run locally. Reindex after changing chunk settings or upgrading the model. Retrieval combines PostgreSQL full-text matching with cosine similarity. Semantic-only results below `RETRIEVAL_MIN_SCORE` (default 0.30) are omitted. The new ranking needs corpus evaluation once PostgreSQL runs.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm test:integration
```

The integration test requires the running PostgreSQL service and `.env`. It checks semantic retrieval, page citations, resource type filters, and unrelated queries against the synthetic fixture. If the untracked supplied PDF is present, it also checks retrieval of its SQL JOIN and integrity constraint sections. Unit tests check website catalog parsing, unresolved course handling, and targeted `copyid` arguments without accessing Drive.

`pnpm build` builds the playground and checks the API TypeScript output. `pnpm dev:all` starts both local services. The main website and main Drive connection remain separate deployment work.
