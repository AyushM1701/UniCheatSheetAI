# UniCheatSheet AI local readiness (29 September 2026)

This is the standalone prototype on the AI PC. The main UniCheatSheet website and main Drive are deliberately **not connected**. The temporary development course context and Drive catalog are not production entitlement data.

## Working locally

- Fastify API on `127.0.0.1:4000`, Next.js UI on `localhost:3000`, PostgreSQL/pgvector, local embeddings, and Gemini generation.
- Allowed courses come from the development access context or a verified website JWT. The UI cannot widen course access. The AI-side JWT verifier can use a single RS256 public key or a local JWKS file containing overlapping keys for rotation.
- Course, material type, and document scopes; indexed resource browsing; cited source details; true streamed model output; deterministic PYQ browsing; and labeled general teaching explanations.
- Resource catalog IDs can be supplied explicitly. Provisional local IDs are used until canonical IDs arrive. Multiple logical catalog entries may name one physical Drive ID; cross-course copies still require separate indexed documents.
- Structured exam-question records hold explicit paper/question metadata. `/v1/pyqs/questions` lists them, and `/v1/pyqs/repeated` counts exact wording repeats across distinct papers. This does **not** infer semantic topic repetition.
- On this PC, the 10 cached catalog PDFs were reindexed successfully with the current pipeline key, the separate 97-page DBMS PDF was reindexed, and the database has 112 structured question records. The development account can browse 13 indexed resources in its allowed courses.
- OCR confidence and review flags remain attached to indexed pages. Tesseract now extracts text and confidence in one pass. KaTeX renders model math. Conversation deletion and a retention purge command are available.
- Replacement indexing tracks revision, pending checksum, last successful indexing time, and last failure. A failed replacement keeps the previous indexed chunks available; this path is covered by an isolated database test.

## Start and verify

1. Start Docker Desktop and run `docker compose up -d` from this repository.
2. Copy `.env.example` to `.env` and set the local database, Gemini, and temporary Drive settings. Keep secrets on the AI PC and out of Git.
3. Run `pnpm install`, `pnpm db:migrate`, and `pnpm db:generate`.
4. For this prototype's existing cached papers, run `pnpm pyq:backfill`. For a fresh catalog, run `pnpm catalog:import catalog/folder-resources.json` after courses and indexing are ready.
5. Run `pnpm dev:all`; open `http://localhost:3000/`.
6. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm eval:retrieval`. Integration tests require a separate database whose name contains `_test` or `_review`.
7. Schedule `pnpm privacy:purge` on the AI PC; `CONVERSATION_RETENTION_DAYS` defaults to 90.

## Configuration to replace before the real rollout

| Prototype setting | Production action on AI PC |
| --- | --- |
| `DEV_ACCESS_CONTEXT_FILE`, `ACCESS_CONTEXT_PROVIDER=dev` | Switch to `ACCESS_CONTEXT_PROVIDER=jwt` after the website issues the agreed token. Set issuer, audience, and public key/JWKS file. |
| `AI_ACCOUNT_KEY_SECRET` | Set a stable random secret of at least 32 characters. It preserves opaque account keys across API restarts. |
| Temporary `DRIVE_REMOTE`, `DRIVE_CATALOG_PATH`, cache | Point the targeted scanner/sync to the authorized main Drive and import canonical resource IDs. Review course/type mapping before indexing. |
| Local `DATABASE_URL` | Use the production PostgreSQL/pgvector database and apply migrations. |
| Prototype `GEMINI_API_KEY` | Use a production key with quotas appropriate to expected traffic. Do not send it to the browser or main website. |
| Local HTTP/CORS | Configure TLS, exact `AI_CORS_ORIGINS`, proxy buffering, request limits, and a public API address. |
| Default `INGESTION_PIPELINE_VERSION`, `PDF_MAX_MB`, OCR flags | Set these for the AI machine. A pipeline change makes documents stale for the next indexing pass; run indexing before relying on new output. |

The main website work is described in `PROJECT_AND_WEBSITE_INTEGRATION.md`. No files in that website were changed for this prototype update.

## Still required for production confidence

- Obtain the real website catalog and paid-course IDs, then verify every resource belongs to the correct course. The temporary catalog has only a small sample of accessible PDFs.
- Implement and test the website's protected original-resource route and sign-in/token handoff. Until then, production mode hides direct Drive links and the prototype cannot prove original opening.
- Run a human-reviewed answer set on the full licensed corpus, including handwritten mathematics and diagrams. OCR text is searchable but does not prove symbol-level correctness.
- Validate actual Hostinger, public proxy, database, TLS, and free-tier limits on their final machines. Rate and concurrency limits are currently per API process; multi-instance deployment needs a shared limiter.
- Add automated browser regression coverage for mobile, keyboard navigation, cancellation, account switching, and network loss. Current browser checks are manual.
- The repeated PYQ endpoint currently detects only exact normalized question wording. Topic clustering, marks extraction from inconsistent paper layouts, and complete OCR/model caching need additional corpus-specific evaluation.
