# UniCheatSheet AI

[![Typecheck](https://img.shields.io/badge/typecheck-passing-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/tests-26%20passed-brightgreen.svg)]()
[![Embeddings](https://img.shields.io/badge/embeddings-all--MiniLM--L6--v2%20(384--dim)-blue.svg)]()
[![Vector%20DB](https://img.shields.io/badge/vector%20db-PostgreSQL%20%2B%20pgvector-orange.svg)]()
[![LLMs](https://img.shields.io/badge/LLM-Google%20Gemini%20%7C%20Ollama-purple.svg)]()
[![Next.js](https://img.shields.io/badge/frontend-Next.js%2015%20(React%2019)-black.svg)]()

> **Academic Retrieval-Augmented Generation (RAG) Platform & Grounded AI Assistant**
> Purpose-built for college students, strictly bounded by semester enrollments, syllabus curricula, lecture materials, and university past-year examination papers (PYQs).

---

## Table of Contents

1. [Key Documentation & Deep Truth](#key-documentation--deep-truth)
2. [Project Analysis & Architectural Truth](#project-analysis--architectural-truth)
   - [Core System Architecture](#core-system-architecture)
   - [Authentication & Entitlement Boundary](#authentication--entitlement-boundary)
   - [Document Processing & Multi-Tier OCR](#document-processing--multi-tier-ocr)
   - [Retrieval Engine & Vector Space](#retrieval-engine--vector-space)
   - [Exam Question (PYQ) Exploration](#exam-question-pyq-exploration)
   - [Prompt Construction & Anti-Hallucination Citations](#prompt-construction--anti-hallucination-citations)
3. [Monorepo Package Map](#monorepo-package-map)
4. [Database Architecture & Schema](#database-architecture--schema)
5. [Local Development & Quickstart](#local-development--quickstart)
   - [Prerequisites](#prerequisites)
   - [Step-by-Step Setup](#step-by-step-setup)
   - [Testing & Quality Verification](#testing--quality-verification)
6. [CLI & Operational Commands](#cli--operational-commands)
7. [API Contract & Endpoints](#api-contract--endpoints)
8. [Production Deployment & Hostinger Guidelines](#production-deployment--hostinger-guidelines)

---

## Key Documentation & Deep Truth

| Document | Purpose & Contents |
| :--- | :--- |
| **[architecture_and_source.md](architecture_and_source.md)** / **[architecture_and_souce.md](architecture_and_souce.md)** | **Complete Single-File Truth**: System architecture, package flows, operational realities, and **every single line of verbatim source code** across all 170+ files in the repository. |
| **[LOCAL_READINESS.md](LOCAL_READINESS.md)** | **Prototype State & Local Readiness (29 Sept 2026)**: Current capabilities, verified local datasets, live components, and exact steps required before production rollout. |
| **[UniCheatSheetAI_Deep_Audit_Implementation_Plan.md](UniCheatSheetAI_Deep_Audit_Implementation_Plan.md)** | **Comprehensive Audit & Roadmap**: Deep analysis of RAG accuracy, models, API security, UI/UX, database revision tracking, and prioritized implementation phases (P0 to P3). |
| **[PROJECT_AND_WEBSITE_INTEGRATION.md](PROJECT_AND_WEBSITE_INTEGRATION.md)** | **Parent Website Integration Contract**: RS256 JWT specification, token minting rules, claims schema, and protected original-resource link handling with `UniCheatSheet.com`. |
| **[deploy/HOSTINGER_HANDOFF.md](deploy/HOSTINGER_HANDOFF.md)** | **Production Deployment & Infrastructure**: Hostinger Node.js configuration, 1.1 GB memory budget, external managed PostgreSQL setup, and ingestion-workstation isolation. |

---

## Project Analysis & Architectural Truth

### Core System Architecture

```text
+---------------------------------------------------------------------------------------+
|                                    Student Browser                                    |
|             (UniCheatSheet.com Web App / Next.js 15 AI Playground :3000)              |
+---------------------------------------------------------------------------------------+
                     │                                            ▲
                     │ 1. User Query + Auth Bearer                │ 6. Real-Time SSE Stream
                     │    (JWT or dev-context.json)                │    (status, sources, token, done)
                     ▼                                            │
+---------------------------------------------------------------------------------------+
|                                      Fastify API                                      |
|                                    (apps/api :4000)                                   |
|   - AccessContextGuard: Validates RS256 JWT / JWKS rotation or dev-context.json       |
|   - Course Isolation: Intercepts & rejects queries outside authorized course set      |
|   - Proxy Hardening: X-Accel-Buffering: no, SSE heartbeat comments, backpressure drain |
+---------------------------------------------------------------------------------------+
                     │
                     │ 2. Scoped Request
                     ▼
+---------------------------------------------------------------------------------------+
|                                  packages/ai-core                                     |
|   - Query Router: Dispatches to Conceptual, Factual, PYQ Search, or Math Solver       |
|   - Context Builder: Enforces course filters, fetches top-K vector/keyword chunks      |
|   - Prompt Builder: Injects structured academic persona & zero-hallucination rules    |
|   - Citation Engine: Real-time chunk citation validator & metadata linker             |
+---------------------------------------------------------------------------------------+
           │                                            │
           │ 3. 384-dim Query Vector                    │ 5. Generation Context Prompt
           ▼                                            ▼
+-----------------------+                    +------------------------------------+
|  packages/embeddings  |                    |       packages/providers/llm       |
|   all-MiniLM-L6-v2    |                    |  - Google Gemini (3.5 Flash-Lite)  |
|   (ONNX Local CPU)    |                    |  - Ollama (qwen2.5:3b / llama3)    |
+-----------------------+                    |  - Mock Provider (CI / Tests)      |
           │                                 +------------------------------------+
           │ 4. Cosine Similarity (<=>)
           ▼
+---------------------------------------------------------------------------------------+
|                                  packages/database                                    |
|                             PostgreSQL 16 + pgvector                                  |
|   Tables: Course, SourceFile, DocumentChunk (HNSW index), ExamQuestion, Conversation  |
+---------------------------------------------------------------------------------------+
```

### Authentication & Entitlement Boundary

- **Decoupled Architecture**: UniCheatSheet AI **never** stores student passwords, processes payments, or manages student accounts.
- **Production Mode (`ACCESS_CONTEXT_PROVIDER=jwt`)**:
  - The parent website (`UniCheatSheet.com`) authenticates users, verifies semester/subscription entitlements, and signs a short-lived (max 15 minutes) RS256 JWT.
  - Supports both a single public key (`AI_JWT_PUBLIC_KEY` / `AI_JWT_PUBLIC_KEY_FILE`) and JWKS key sets for zero-downtime key rotation.
  - JWT Claims: `sub` (opaque student identifier), `semester` (integer), `courses` (array of canonical course IDs), `exp` (timestamp $\le$ 15m), and optional `currentCourseId`.
  - Student conversation history is tied to an HMAC-derived account key using `AI_ACCOUNT_KEY_SECRET`.
- **Standalone Development Mode (`ACCESS_CONTEXT_PROVIDER=dev`)**:
  - Reads `dev-context.json` to simulate student course grants without a live authentication server.
  - Strictly prevents browser queries from bypassing allowed courses.

### Document Processing & Multi-Tier OCR

The ingestion pipeline ([packages/document-processing](packages/document-processing)) processes course documents through tiered extraction:

1. **Digital PDF Text Extraction**: High-fidelity text extraction with line-by-line bounding coordinates and header preservation using `pdf-parse` / `pdf2json`.
2. **Low-Text & Scanned Page Detection**: Pages yielding under 50 valid characters are automatically flagged for OCR.
3. **Single-Pass Tesseract OCR**: Converts PDF pages to high-resolution PNGs via Poppler `pdftoppm` and runs Tesseract OCR to retrieve both extracted text and page-level confidence scores in a single pass.
4. **TrOCR Handwriting Fallback**: For university papers with handwritten diagrams or equations, `scripts/ocr_page.py` uses Microsoft's TrOCR (`microsoft/trocr-base-handwritten`) to extract handwritten formulas and notes.
5. **Safe Replacement Indexing**: Revision tracking with `document_revision_status` safeguards existing indexed chunks. A failed re-indexing attempt leaves active chunks intact and logs the failure rather than destroying search availability.

### Retrieval Engine & Vector Space

- **Local Zero-Cost Embeddings**: Uses `@xenova/transformers` with `sentence-transformers/all-MiniLM-L6-v2` running natively in ONNX on the CPU. Outputs normalized 384-dimensional dense vectors.
- **HNSW Cosine Distance Index**: Indexed via PostgreSQL `pgvector` with HNSW (`vector_cosine_ops`), executing sub-millisecond nearest-neighbor search.
- **Hybrid Keyword & Semantic Fusion**: Queries combine PostgreSQL full-text search with cosine similarity distance, strictly filtered by the student's authorized course set (`courseId IN (...)`).
- **Score Thresholding**: Candidate chunks scoring below `RETRIEVAL_MIN_SCORE` (default `0.30`) are discarded to prevent hallucinations.

### Exam Question (PYQ) Exploration

- **Granular Question Chunking**: Exam papers are automatically parsed into individual question records ([packages/document-processing/src/exam-questions.ts](packages/document-processing/src/exam-questions.ts)) tracking question number (e.g. `Q1(a)`), unit/section, allocated marks, and normalized text.
- **Dedicated PYQ API Routes**:
  - `GET /v1/pyqs/questions`: Search and list structured exam questions by course, unit, or exam year.
  - `GET /v1/pyqs/repeated`: Detects exact question repetitions across different exam years to identify high-probability test questions.

### Prompt Construction & Anti-Hallucination Citations

- **Strict Academic Grounding**: Prompts enforce that every factual claim must cite an injected chunk using `[Doc <id>, p. <page>]`. If retrieved chunks are insufficient, the model must explicitly state that the material is not in the course notes.
- **Streaming Citation Engine**: As tokens stream via Server-Sent Events, the citation engine identifies citation markers, validates their document IDs against server-verified chunks, maps them to source URLs and page images, and delivers interactive badge metadata to the UI.
- **KaTeX Mathematics Support**: Formulas, LaTeX equations (`$...$`, `$$...$$`), and chemical equations are parsed and rendered via KaTeX in the Next.js playground.

---

## Monorepo Package Map

```text
├── apps/
│   ├── api/                   # Fastify REST & SSE streaming server (port 4000)
│   └── playground/            # Next.js 15 (React 19) Chat UI with KaTeX math (port 3000)
├── packages/
│   ├── ai-core/               # Prompt construction, citation engine, query router, chat memory
│   ├── database/              # Prisma client wrapper, schema definitions, and migrations
│   ├── document-processing/   # PDF parsing, structural chunking, exam question regex, OCR fallback
│   ├── drive-sync/            # Google Drive downloader & synchronizer via rclone copyid
│   ├── embeddings/            # Local ONNX transformer embeddings (all-MiniLM-L6-v2, 384-dim)
│   ├── indexing/              # Document chunker, vectorizer, and database indexer
│   ├── ingestion/             # Batch ingestion, catalog reconciliation, exam metadata builder
│   ├── providers/llm/         # Pluggable LLM clients (Gemini, Ollama, Mock)
│   ├── retrieval/             # Scoped hybrid retrieval (PostgreSQL pgvector cosine distance)
│   ├── shared/                # Cross-cutting utilities, types, and logging
│   └── unicheatsheet-source/  # Catalog builder & scanner for UniCheatSheet site
├── catalog/                   # Course definitions, Drive folder links, and resource catalogs
├── deploy/                    # Caddy, Cloudflare tunnel, and Hostinger deployment guides
├── evals/                     # Retrieval evaluation benchmark datasets
├── prisma/                    # Prisma schema and 9 SQL migrations
├── scripts/                   # CLI maintenance, sync, eval, and diagnostic scripts
└── tests/                     # Unit and isolated database integration tests
```

---

## Database Architecture & Schema

PostgreSQL 16 with the `pgvector` extension stores:

- **`Course`**: Canonical course metadata (e.g. `dbms`, `physics`, `computer-architecture`), semester, and title.
- **`SourceFile`**: Ingested files, original filenames, Drive file IDs, SHA-256 hashes, revision number, indexing timestamps, and OCR review flags.
- **`DocumentChunk`**: Text chunks, token counts, start/end page numbers, section headers, resource types (`lecture`, `pyq`, `notes`), and 384-dimensional vector embeddings with an HNSW cosine index.
- **`ExamQuestion`**: Extracted questions from PYQ papers with normalized question numbers, marks, units, and year metadata.
- **`Conversation`**: User chat threads tied to opaque student identifiers and scoped to specific course IDs.
- **`Message`**: Exchange history with role (`user`, `assistant`), message content, and token counts.
- **`Citation`**: Source attributions linking assistant messages to specific `DocumentChunk` records.

---

## Local Development & Quickstart

### Prerequisites
- **Node.js**: v22+
- **pnpm**: v9+ (`npm install -g pnpm`)
- **Docker Desktop**: Running locally for PostgreSQL + `pgvector`
- **Python**: 3.10+ (optional, needed only for TrOCR handwriting OCR)
- **rclone**: (optional, needed only for live Google Drive sync)

### Step-by-Step Setup

1. **Clone & Install Dependencies**:
   ```sh
   git clone https://github.com/AyushM1701/UniCheatSheetAI.git
   cd unicheatsheetAI
   pnpm install
   ```

2. **Configure Environment**:
   ```sh
   cp .env.example .env
   ```
   *(Windows PowerShell: `Copy-Item .env.example .env`)*

   Key settings in `.env`:
   - `GEMINI_API_KEY`: Your Google AI Studio API key.
   - `DATABASE_URL`: `postgresql://ucs:ucs@localhost:5432/ucs_ai?schema=public`
   - `ACCESS_CONTEXT_PROVIDER`: `dev` (uses `dev-context.json` for local testing)

3. **Start PostgreSQL & Run Database Migrations**:
   ```sh
   docker compose up -d postgres
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```

4. **Index Cached Study Materials & PYQs**:
   ```sh
   # Index cached catalog PDFs (10 papers across Architecture, Digital Electronics, Physics)
   pnpm index:catalog catalog/folder-resources.json

   # Backfill structured exam questions from indexed PYQ papers
   pnpm pyq:backfill
   ```

5. **Start Development Servers**:
   ```sh
   pnpm dev:all
   ```
   - **Playground UI**: [http://localhost:3000](http://localhost:3000)
   - **Fastify API**: [http://127.0.0.1:4000](http://127.0.0.1:4000)

### Testing & Quality Verification

```sh
# Typecheck all monorepo packages and apps
pnpm typecheck

# Run unit tests across all packages (26 tests)
pnpm test

# Run retrieval benchmark evaluation
pnpm eval:retrieval

# Run isolated database integration tests (requires Docker PostgreSQL)
pnpm test:integration
```

---

## CLI & Operational Commands

| Command | Action |
| :--- | :--- |
| `pnpm dev:all` | Concurrently runs Fastify API (`:4000`) and Next.js Playground (`:3000`). |
| `pnpm db:migrate` | Applies Prisma migrations to PostgreSQL. |
| `pnpm db:seed` | Populates baseline course catalog records into PostgreSQL. |
| `pnpm scan:folders` | Scans configured Google Drive folder IDs and builds `catalog/folder-resources.json`. |
| `pnpm sync:drive <catalog>` | Downloads and caches target Drive files sequentially via `rclone copyid`. |
| `pnpm index:catalog <catalog>` | Chunks, embeds, and indexes cached PDFs into PostgreSQL vector storage. |
| `pnpm pyq:backfill` | Parses all indexed PYQ papers and extracts structured `ExamQuestion` records. |
| `pnpm catalog:import <catalog>` | Validates and imports canonical course and resource catalogs. |
| `pnpm eval:retrieval` | Executes automated accuracy smoke tests against 6 benchmark queries. |
| `pnpm privacy:purge` | Purges conversations older than retention limit (`CONVERSATION_RETENTION_DAYS`, default 90). |
| `pnpm test:chat "<query>" <course>` | CLI end-to-end chat test with source citations. |

---

## API Contract & Endpoints

All endpoints are hosted on `http://127.0.0.1:4000` (proxied by the UI at `/api/ai/*`):

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/v1/health` | `GET` | Health check for API server and database connectivity. |
| `/v1/ready` | `GET` | Readiness probe confirming PostgreSQL and pgvector index availability. |
| `/v1/context` | `GET` | Returns active student semester, allowed courses, and active course ID. |
| `/v1/courses` | `GET` | Lists courses permitted under student's access context. |
| `/v1/retrieve` | `POST` | Executes scoped semantic and keyword search; returns top chunks. |
| `/v1/chat` | `POST` | Synchronous chat endpoint with validated answers and source citations. |
| `/v1/chat/stream` | `POST` | SSE streaming chat endpoint with real-time tokens and source resolution. |
| `/v1/pyqs/questions` | `GET` | Browses extracted exam questions by course, unit, and marks. |
| `/v1/pyqs/repeated` | `GET` | Identifies questions repeated verbatim across multiple exam sessions. |
| `/v1/conversations` | `GET` | Lists user's past conversation sessions. |
| `/v1/conversations/:id` | `GET` / `DELETE` | Retrieves or permanently deletes a user conversation thread. |

---

## Production Deployment & Hostinger Guidelines

For full hosting instructions, consult **[deploy/HOSTINGER_HANDOFF.md](deploy/HOSTINGER_HANDOFF.md)**:

1. **Role Division**:
   - **Ingestion Workstation**: Runs heavy tools (Python, Poppler, Tesseract, TrOCR, rclone, PDF downloads).
   - **Hostinger Node.js Web Server**: Runs only the Fastify API and Next.js frontend within the 1.1 GB memory budget.
   - **External Managed Database**: PostgreSQL 16 + `pgvector` (e.g. Supabase, Neon, or cloud Postgres).
2. **Environment & Security**:
   - Switch `ACCESS_CONTEXT_PROVIDER=jwt`.
   - Configure `AI_JWT_PUBLIC_KEY_FILE` (or JWKS file) and set strict `AI_CORS_ORIGINS`.
   - Set `AI_ACCOUNT_KEY_SECRET` ($\ge$ 32 chars) for stable opaque student account keys.
   - Set production `GEMINI_API_KEY`.
3. **Reverse Proxy Configuration**:
   - Set `X-Accel-Buffering: no` on Caddy, Nginx, or Cloudflare to prevent buffering of SSE streaming responses.
