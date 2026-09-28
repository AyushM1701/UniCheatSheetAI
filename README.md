# UniCheatSheet AI

> Academic retrieval-augmented generation (RAG) assistant purpose-built for university students, strictly grounded in course notes, lecture slides, syllabus materials, and past-year exam questions (PYQs).

---

## Key Documentation

- **[Architecture & Complete Source Code (Single-File Truth)](architecture_and_souce.md)**: Exhaustive system architecture breakdown, operational truth, and verbatim source code of every tracked file in this repository.
- **[Deep Audit & Implementation Plan](UniCheatSheetAI_Deep_Audit_Implementation_Plan.md)**: Comprehensive deep audit covering core RAG, models, API security, UI/UX, Hostinger production readiness, and prioritized execution phases.
- **[Main Website Integration Guide](PROJECT_AND_WEBSITE_INTEGRATION.md)**: Specifications for the parent site (`UniCheatSheet.com`) connection, short-lived RS256 JWT auth contract, and protected resource link flows.
- **[Hostinger Deployment & Infrastructure Handoff](deploy/HOSTINGER_HANDOFF.md)**: Production deployment instructions, memory quota analysis, environment configurations, and ingestion vs API role boundaries.

---

## 1. System Overview

UniCheatSheet AI operates as an independent, companion intelligence service for **UniCheatSheet.com**. It indexes study materials (lecture slides, typed notes, textbook chapters, and university exam papers) to deliver:

1. **Grounded Answers with Exact Citations**: Responses are strictly synthesized from retrieved course chunks formatted as `[Doc <id>, p. <page>]`. Unknown citations and unverified claims are intercepted and filtered.
2. **Interactive PYQ Exploration & Question Breakdown**: University exam papers are segmented by individual questions (e.g. Q1(a), Q2(b)), units, and marks for targeted revision.
3. **Multi-Tenant Semester & Course Isolation**: Retrieval is strictly bounded to the student's authorized course enrollment. A student cannot search or leak materials outside their entitled curriculum.
4. **Zero-API-Cost Local Embeddings**: Uses `all-MiniLM-L6-v2` (384 dimensions) running locally via ONNX runtime on CPU, avoiding embedding API costs and network latency.
5. **Pluggable LLM Backends**: Google Gemini (`gemini-3.5-flash-lite`, `gemini-2.5-flash`), local Ollama (`qwen2.5:3b`, `llama3`), or Mock provider for testing.
6. **Multi-Modal Document Processing & OCR Fallback**: Standard digital text extraction with automatic fallback to local OCR (Poppler `pdftoppm` + Tesseract) and handwritten model fallback (TrOCR) for scanned exam sheets.

---

## 2. Monorepo Structure

Built as a `pnpm` monorepo:

```text
├── apps/
│   ├── api/                   # Fastify HTTP & SSE server (port 4000)
│   └── playground/            # Next.js 15 (React 19) Chat UI with KaTeX math (port 3000)
├── packages/
│   ├── ai-core/               # Prompt building, citation engine, query router, chat memory
│   ├── database/              # Prisma ORM client & PostgreSQL migrations with pgvector
│   ├── document-processing/   # PDF extraction, chunking, exam question regex, OCR fallback
│   ├── drive-sync/            # Google Drive downloader & synchronizer via rclone copyid
│   ├── embeddings/            # Local ONNX transformer embeddings (all-MiniLM-L6-v2, 384-dim)
│   ├── indexing/              # Document chunker, vectorizer, and database indexer
│   ├── ingestion/             # Batch ingestion and catalog reconciliation pipeline
│   ├── providers/llm/         # Pluggable LLM clients (Gemini, Ollama, Mock)
│   ├── retrieval/             # Scoped hybrid retrieval (PostgreSQL pgvector cosine distance)
│   ├── shared/                # Cross-cutting utilities, types, and logging
│   └── unicheatsheet-source/  # Catalog builder & scanner for UniCheatSheet site
├── catalog/                   # Course definitions, Drive folder links, and resource catalogs
├── deploy/                    # Caddy, Cloudflare tunnel, and Hostinger deployment guides
├── evals/                     # Retrieval evaluation benchmark datasets
├── prisma/                    # Prisma schema and SQL migrations
├── scripts/                   # CLI maintenance, sync, eval, and diagnostic scripts
└── tests/                     # Unit and isolated database integration tests
```

---

## 3. Quickstart & Local Setup

### Prerequisites
- **Node.js**: v22+
- **pnpm**: v9+
- **Docker Desktop**: (for local PostgreSQL with `pgvector`)
- **Python**: 3.10+ (optional, required only for TrOCR handwriting fallback)
- **rclone**: (optional, required only for Google Drive sync)

### Step 1: Install Dependencies & Setup Environment

```sh
pnpm install
cp .env.example .env
```
*(On Windows PowerShell, use `Copy-Item .env.example .env`)*

Configure your `.env`:
- Add your `GEMINI_API_KEY` (if using Google Gemini).
- Keep `DEV_ACCESS_CONTEXT_FILE=dev-context.json` and `ACCESS_CONTEXT_PROVIDER=dev` for local standalone testing.

### Step 2: Start PostgreSQL with pgvector & Migrate

```sh
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### Step 3: Index Sample / Catalog Documents

To index the cached prototype catalog (10 PDFs including Computer Architecture, Digital Electronics, and Physics):
```sh
pnpm index:catalog catalog/folder-resources.json
```

To run the retrieval evaluation benchmark:
```sh
pnpm eval:retrieval
```

### Step 4: Start Development Servers

Run both the Fastify API (port 4000) and Next.js Playground (port 3000) concurrently:
```sh
pnpm dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Grounded Chat & API Endpoints

### Core API Routes (`apps/api`)
- `GET /v1/health`: System health and database connectivity check.
- `GET /v1/ready`: PostgreSQL and pgvector schema readiness probe.
- `GET /v1/context`: Active student access context (semester, allowed courses, active course).
- `GET /v1/courses`: List of courses entitled to the active student.
- `POST /v1/retrieve`: Direct vector & keyword retrieval scoped to student's courses.
- `POST /v1/chat`: Synchronous chat endpoint with citations and retrieval metadata.
- `POST /v1/chat/stream`: Server-Sent Events (SSE) streaming endpoint emitting `status`, `sources`, `token`, and `done` events.
- `GET /v1/pyqs`: Browse extracted past-year exam questions filtered by course, unit, or exam year.

### Testing Chat via CLI

```sh
pnpm test:chat "Explain normalization forms in databases" dbms
```

---

## 5. Security & Authentication Architecture

In production, UniCheatSheet AI acts as an isolated backend that **does not manage user logins or store passwords**.

```text
Student Browser
     │
     ▼ 1. Authenticate with UniCheatSheet.com (Session/OAuth/Stripe)
Parent Website (UniCheatSheet.com)
     │
     ▼ 2. Mint short-lived RS256 JWT (exp <= 15 minutes)
     │    Claims: sub, semester, courses: ["course-1", "course-2"]
Student Browser / AI Client
     │
     ▼ 3. Authorization: Bearer <JWT>
UniCheatSheet AI API (apps/api)
     ├── Verifies signature against AI_JWT_PUBLIC_KEY
     └── Enforces student's courses[] on ALL database and retrieval queries
```

- **Standalone Mode (`dev`)**: Uses [dev-context.json](dev-context.json) to simulate student enrollments.
- **Production Mode (`jwt`)**: Requires `ACCESS_CONTEXT_PROVIDER=jwt`, valid `AI_JWT_PUBLIC_KEY_FILE`, and explicit `AI_CORS_ORIGINS`. Original Google Drive URLs are stripped to prevent unauthorized scraping of paid materials.

---

## 6. Document Processing & OCR Pipeline

The ingestion pipeline handles both typed digital PDFs and low-fidelity scanned papers:

1. **Digital PDF Parsing**: Extracts text per page, preserves section headers, and tracks page numbers.
2. **Low-Text Detection**: Pages with low character density trigger the OCR engine.
3. **Tesseract OCR**: Uses Poppler `pdftoppm` and Tesseract to extract typed scanned pages.
4. **TrOCR Handwriting Fallback**: Low-confidence or handwritten exam papers can invoke `scripts/ocr_page.py` (Microsoft TrOCR) offline on the ingestion workstation.
5. **Exam Question Extraction**: Regex heuristics parse questions, sub-questions (a, b, c), unit headers, and marks allocation into distinct `exam_question` chunks.

---

## 7. Testing & Quality Verification

```sh
# Typecheck all packages and apps
pnpm typecheck

# Run unit tests across packages
pnpm test

# Run isolated database integration tests (requires Docker PostgreSQL)
pnpm test:integration

# Run retrieval benchmark accuracy suite
pnpm eval:retrieval
```

*Note: Integration tests strictly require a separate test database (containing `_test` or `_review` in the database name) to safeguard development and production data.*

---

## 8. Deployment & Production Operations

- **Reverse Proxy / SSL**: Fastify listens on `127.0.0.1:4000`. Deploy behind Caddy ([deploy/Caddyfile.example](deploy/Caddyfile.example)), Nginx, or Cloudflare Tunnels ([deploy/cloudflared.example.yml](deploy/cloudflared.example.yml)).
- **Hostinger Production Target**: Review [deploy/HOSTINGER_HANDOFF.md](deploy/HOSTINGER_HANDOFF.md) for node process memory constraints, environment variable setup, and managed PostgreSQL connectivity.
- **Maintenance Scripts**:
  - `pnpm scan:folders`: Scan configured Google Drive folder IDs.
  - `pnpm sync:drive <catalog>`: Download and cache missing PDFs using `rclone copyid`.
  - `pnpm index:catalog <catalog>`: Ingest cached PDFs into PostgreSQL vector storage.
  - `pnpm reconcile:catalog <catalog>`: Review and prune stale indexed resources.
