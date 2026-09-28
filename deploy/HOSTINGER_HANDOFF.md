# Hostinger handoff for UniCheatSheet AI

This repository is still a local prototype. The main UniCheatSheet website, main Drive, Hostinger account, and remote database are **not connected**. Keep the ingestion machine and public API as separate deployments. First confirm whether the stated 1.1 GB is RAM, disk, or an application quota, and that the Hostinger plan actually supports a long-running Node.js app. Hostinger lists Fastify among supported Node frameworks on eligible managed plans: [Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/), [Node app deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

## What runs where

| Component | Development/ingestion PC | Hostinger | Remote Postgres |
| --- | --- | --- | --- |
| Main Drive rclone remote and OAuth tokens | Yes | No | No |
| PDF cache, Poppler, Tesseract, optional PaddleOCR/TrOCR | Yes | No | No |
| Chunking and document embeddings | Yes | No | Resulting chunks/vectors |
| Fastify API, JWT verification, chat and retrieval | No in production | Yes | Reads/writes |
| Query embedding model (MiniLM) | During local development | **Currently yes** | No |
| Gemini API key | Local development only | Yes | No |
| Original scanned page PNGs | Yes | No | Only extraction metadata |

The existing API **still computes query embeddings with MiniLM**. It is therefore not a pure zero-model server. Measure its memory and disk footprint on the actual Hostinger plan before publishing. If it exceeds the quota, provision a small persistent embedding service elsewhere or change the embedding strategy and reindex; do not silently switch query embeddings to another model, because document and query vectors must use the same model. The current Windows `pnpm deploy` artifact was about 745 MB including dependencies and a cached 86 MB ONNX model; a Linux build will differ. Build on Linux for Linux hosting because Prisma and ONNX include platform binaries.

## Local handwriting ingestion

Set `OCR_ENABLED=true`, `PDFTOPPM_BINARY`, and `OCR_BINARY` on the ingestion PC. The parser first uses PDF text. Low-text pages are rendered at `OCR_RENDER_DPI` (default 275) into `PAGE_IMAGE_DIR/<PDF SHA-256>/page-N.png`, then Tesseract reads them. `OCR_ENGINE=auto` sends low-confidence pages to the Python worker. Set `OCR_HANDWRITING_ENABLED=true` to use local TrOCR on detected text lines; the model is downloaded to the **ingestion PC** on first use. `OCR_PADDLE_ENABLED=true` optionally enables PaddleOCR for scanned print, after its compatible Python dependencies are installed. TrOCR is [intended for single text-line images](https://huggingface.co/microsoft/trocr-base-handwritten), so the worker segments pages before inference. The model is MIT licensed; its results still need review for technical terms and math.

The metadata written to Postgres contains extraction method, OCR confidence when available, and a review flag. It does **not** send local page paths to the remote database. The local playground can preview a page through an access-checked API endpoint; that endpoint is disabled in production. Production citations should open the protected original on the main website or Drive. A future page-preview storage service would need its own authorization; it is not required for the first deployment.

The provided 15-page handwritten linear-algebra assignment was tested locally. Tesseract recovered text on all pages but made many transcription errors. TrOCR improved portions of a representative page but also misread technical words and equations. This is searchable, reviewable OCR, **not reliable mathematical transcription**. Keep the review flag and original-page link visible. Do not use OCR alone to assert an exact equation.

## Prepare the remote database

1. Create a PostgreSQL service with pgvector, for example Supabase. [Supabase supports pgvector](https://supabase.com/docs/guides/ai/vector-columns) and documents [Prisma connection strings](https://supabase.com/docs/guides/database/prisma). Confirm current limits before importing the full Drive; Supabase currently documents a 500 MB free database read-only threshold in its [database-size guide](https://supabase.com/docs/guides/platform/database-size).
2. Enable the `vector` extension in the target database. Create a dedicated database role and get a **server-only** Postgres connection string. This project uses `DATABASE_URL` directly with Prisma; it does **not** require `SUPABASE_SERVICE_ROLE_KEY` or a Supabase browser API key.
3. On the ingestion PC, back up the prototype database and create a distinct production env file outside Git. Point `DATABASE_URL` at the production database only for migration/seed/indexing commands. Never accidentally run integration tests against it. `pnpm db:migrate`, then `pnpm db:seed`. Review the existing migration SQL and role privileges before applying it to production.
4. Replace the provisional course IDs in `catalog/courses.json` and the resource catalog with the IDs the main website will sign into JWTs. Reconfigure rclone on the ingestion PC for the **main Drive** and scan only the authoritative source. Sync and index locally. The remote Postgres receives text, vectors, and metadata; it does not receive PDFs or rclone credentials.
5. Re-run indexing when PDFs, course mapping, chunk settings, OCR settings, or embedding model change. Ingestion's indexing key includes OCR configuration. Monitor `pg_database_size(current_database())`, document counts, and failed ingestion runs.

## Package the API

Run these steps on a Linux environment matching Hostinger, with Node 22 and pnpm 11. Do not upload the entire repository or the local `.env`.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm typecheck
pnpm --config.inject-workspace-packages=true --filter @ucs/api deploy --prod /tmp/ucs-ai-api
```

The production package should contain only API runtime workspace packages: `ai-core`, `database`, `retrieval`, `shared`, and their dependencies. Check it for `@ucs/ingestion`, `@ucs/document-processing`, PDFs, `rclone.conf`, `scripts/ocr_page.py`, and `.env`; none belong in the upload. The MiniLM ONNX files are a runtime dependency and must be available through an absolute writable `HF_MODEL_CACHE_DIR`, or preloaded into the deployment. A package generated on Windows is not a Linux release artifact. Set the Hostinger start command to `pnpm start` (or `node_modules/.bin/tsx src/server.ts`) from the deployed API directory. The API serves `/v1/ready` for database readiness.

The isolated Windows package was smoke-tested locally on a separate port: `/v1/ready` returned ready and `/v1/retrieve` found the Flynn taxonomy source. This verifies the package boundary on this PC, not Hostinger compatibility or its 1.1 GB quota.

If the actual Hostinger quota is 1.1 GB of RAM, benchmark cold start, query embedding, and concurrent chat requests before enabling public traffic. `AI_MAX_CONCURRENT_CHATS=1` limits chat generation concurrency; it does not reduce ONNX model memory. If 1.1 GB is disk, measure the Linux package plus model cache. Move the API to a larger plan or external embedding service if either measurement exceeds the quota.

## Hostinger server-only configuration

Set these through the hosting control panel or secret store, not in a committed file:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=<port supplied by Hostinger>
DATABASE_URL=<server-only Postgres connection string>
EMBEDDING_PROVIDER=local
HF_MODEL_CACHE_DIR=<absolute writable path to MiniLM model cache>
ACCESS_CONTEXT_PROVIDER=jwt
AI_CORS_ORIGINS=https://unicheatsheet.com,https://www.unicheatsheet.com
AI_JWT_PUBLIC_KEY=<PEM with escaped newlines, or use AI_JWT_PUBLIC_KEY_FILE>
AI_JWT_ISSUER=https://unicheatsheet.com
AI_JWT_AUDIENCE=unicheatsheet-ai
LLM_PROVIDER=gemini
GEMINI_API_KEY=<production key>
GEMINI_MODEL=<tested model>
OCR_ENABLED=false
AI_REQUESTS_PER_MINUTE=30
AI_MAX_CONCURRENT_CHATS=1
```

The main website keeps the **JWT private signing key**. Hostinger needs only the matching public key. `DATABASE_URL`, `GEMINI_API_KEY`, and the public-key file must be rotated if exposed. No Google Drive OAuth secret, rclone configuration, Python environment, TrOCR model, PDF, or page image belongs on Hostinger.

## Minimal main website changes

1. Keep its existing login, payment, course pages, and resource links. Add one server-only endpoint that checks the existing authenticated session and course entitlements, then signs an RS256 AI JWT valid for at most 15 minutes. Read `semester` from that student's current website enrollment record for each token; never set it to a constant. Claims: `iss`, `aud`, opaque `sub`, `iat`, `exp`, `semester`, `courses` (actual AI course IDs), and optional `currentCourseId`.
2. Add an AI entry point or link from the existing website. Its frontend obtains the short-lived token from that same-origin endpoint and calls `configureAiClient({ tokenProvider, apiBaseUrl })` or equivalent. Do not expose the signing key in browser JavaScript. A separate AI frontend is fine; this does not require redesigning the main site.
3. Route HTTPS `ai-api.unicheatsheet.com` to Hostinger and allow the actual website origins in `AI_CORS_ORIGINS`. Use TLS. Verify `GET /v1/me/context`, course restrictions, chat streaming, citations, and history with a real entitled account and a denied account.
4. For production citations, have the site resolve its existing resource IDs to protected original PDF/page links after its normal entitlement check. The AI API intentionally hides direct Drive URLs in JWT mode. Do not make the temporary Drive or local scanned-page cache public.

The full website token and integration contract remains in [PROJECT_AND_WEBSITE_INTEGRATION.md](../PROJECT_AND_WEBSITE_INTEGRATION.md). None of the above production connections have been made in this prototype.
