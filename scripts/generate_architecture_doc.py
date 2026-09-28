import os
import subprocess
import hashlib

def get_file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def get_language(filename):
    ext = os.path.splitext(filename)[1].lower()
    mapping = {
        '.ts': 'typescript',
        '.tsx': 'tsx',
        '.js': 'javascript',
        '.jsx': 'jsx',
        '.json': 'json',
        '.py': 'python',
        '.sql': 'sql',
        '.css': 'css',
        '.html': 'html',
        '.yml': 'yaml',
        '.yaml': 'yaml',
        '.toml': 'toml',
        '.md': 'markdown',
        '.sh': 'bash',
        '.env': 'bash',
        '.example': 'bash',
    }
    return mapping.get(ext, '')

def main():
    tracked_files = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
    tracked_files.sort()

    output_paths = ['architecture_and_source.md', 'architecture_and_souce.md']

    architecture_truth_header = """# UniCheatSheet AI: Comprehensive Architecture, Ground Truth, and Complete Source Code

> **Generated Document**: Complete System Architecture, Operational Ground Truth, Deep Project Analysis, and Exact Codebase Reproduction.
> **Repository**: [UniCheatSheetAI](https://github.com/AyushM1701/UniCheatSheetAI.git)

---

## 1. Executive Summary & Purpose

UniCheatSheet AI is an academic retrieval-augmented generation (RAG) assistant purpose-built for university students. It directly indexes study materials (lecture slides, typed lecture notes, textbook chapters, and past-year exam questions / PYQs) to provide:
1. **Direct Answers with Exact Citations**: Answering student queries with strict grounding, precise chunk citations, page numbers, and original document references.
2. **Past Exam Question (PYQ) Exploration**: Parsing, unit classification, marks breakdown, and repeated question analysis across university examination sessions.
3. **Course & Semester Scoping**: Restricting student queries strictly to materials belonging to courses they are enrolled in or entitled to access.
4. **Zero-API-Cost Local Embeddings**: Using CPU-friendly local ONNX embeddings (`all-MiniLM-L6-v2`, 384 dimensions) and pluggable LLM backends (Google Gemini API with Ollama fallback).
5. **Multi-Modal Document Processing & OCR Fallback**: Digital PDF extraction with automated fallback to Poppler/Tesseract OCR and Microsoft TrOCR handwriting extraction.

---

## 2. Deep Project Analysis & Core Architecture

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

### 2.1 Package Breakdown & Responsibilities
- **`apps/api`**: Fastify REST / SSE service exposing `/v1/chat/stream`, `/v1/chat`, `/v1/courses`, `/v1/retrieve`, `/v1/pyqs/questions`, `/v1/pyqs/repeated`, and `/v1/health`.
- **`apps/playground`**: Next.js 15 (React 19, Tailwind CSS) chat interface featuring markdown rendering, KaTeX math expressions, interactive citation badges, slide-out source drawer, and scope selector.
- **`packages/ai-core`**: Core orchestration pipeline; manages chat lifecycle, memory, citation resolution, and prompt formatting.
- **`packages/database`**: Prisma client wrapper, schema definitions, and 9 database migrations.
- **`packages/document-processing`**: PDF text extraction, markdown normalization, hierarchical heading chunking, exam question regex extraction, and TrOCR OCR fallback.
- **`packages/drive-sync`**: Downloader and synchronizer syncing university study materials from Google Drive via `rclone copyid`.
- **`packages/embeddings`**: Transformer pipeline wrapping ONNX runtime for local inference (`all-MiniLM-L6-v2`).
- **`packages/indexing`**: Ingestion worker that parses PDFs, computes chunk embeddings, and synchronizes the vector database with safe revision rollback.
- **`packages/ingestion`**: Batch pipeline orchestrator for reconciling catalog records against filesystem files and extracting exam question metadata.
- **`packages/providers/llm`**: Pluggable provider layer for LLMs with unified streaming interfaces (Gemini, Ollama, Mock).
- **`packages/retrieval`**: SQL / pgvector retrieval layer executing cosine distance searches scoped to valid course IDs.
- **`packages/shared`**: Cross-cutting utilities (logging, errors, types).
- **`packages/unicheatsheet-source`**: Catalog parser and scanner for the UniCheatSheet website structure.

---

## 3. Operational Ground Truth & Critical Realities

1. **Authentication & Entitlements**:
   - The AI backend does **not** store student passwords or process payments.
   - It relies entirely on short-lived RS256 JWTs signed by the parent site (`UniCheatSheet.com`), transmitting the student's `semester` and allowed `courses` list.
   - The verifier supports single public keys as well as JWKS rotation.
   - For standalone development, `dev-context.json` provides simulated entitlements.
2. **Vector Space & Similarity Search**:
   - Embeddings use `sentence-transformers/all-MiniLM-L6-v2` producing normalized 384-dimensional vectors.
   - Database vector distance metric is cosine distance (`<=>`), indexed via `pgvector` HNSW indexes for sub-millisecond retrieval.
3. **Structured Exam Question (PYQ) Exploration**:
   - Dedicated `ExamQuestion` records store normalized question text, question numbers (e.g. Q1a, Q2b), marks, and unit mapping.
   - The `/v1/pyqs/repeated` endpoint analyzes exact question repetitions across past university exam papers.
4. **Safe Replacement Indexing**:
   - `SourceFile` revision tracking (`document_revision_status`) prevents downtime during document re-indexing. If re-indexing fails, existing chunks remain intact and searchable.
5. **Citation & Anti-Hallucination**:
   - The LLM is strictly instructed never to fabricate sources. Every claim must refer to injected chunks formatted as `[Doc <id>, p. <page>]`.
   - The `citation-engine` catches and validates citation markers in real-time streaming chunks, linking them to source files and page numbers.
6. **Multi-Tier OCR Fallback**:
   - For scanned exam papers or handwritten slides where standard PDF text extractors return zero or garbled text, Poppler `pdftoppm` + Tesseract extracts text and confidence in a single pass.
   - For difficult handwriting, `packages/document-processing/src/ocr.ts` delegates pages to `scripts/ocr_page.py` (TrOCR) to ensure no course materials are lost.

---

## 4. Complete Codebase Index

Below is the exhaustive, verbatim content of every tracked file in this repository.

"""

    file_contents = []

    for rel_path in tracked_files:
        abs_path = os.path.abspath(rel_path)
        block = []
        block.append(f"\n\n{'='*80}\n")
        block.append(f"## File: `{rel_path}`\n")
        block.append(f"{'='*80}\n\n")

        if rel_path.endswith(('.pdf', '.webp')):
            file_size = os.path.getsize(abs_path)
            sha = get_file_hash(abs_path)
            block.append(f"> **Binary Asset**: `{rel_path}`\n")
            block.append(f"> **File Size**: {file_size} bytes\n")
            block.append(f"> **SHA-256**: `{sha}`\n\n")
            block.append("*(Binary asset content omitted from text rendering)*\n")
            file_contents.append("".join(block))
            continue

        lang = get_language(rel_path)
        try:
            with open(abs_path, 'r', encoding='utf-8', errors='replace') as sf:
                content = sf.read()

            fence = '```'
            if '```' in content:
                fence = '````'
            if '````' in content:
                fence = '`````'

            block.append(f"{fence}{lang}\n")
            block.append(content)
            if not content.endswith('\n'):
                block.append('\n')
            block.append(f"{fence}\n")
        except Exception as e:
            block.append(f"*Error reading file: {e}*\n")

        file_contents.append("".join(block))

    full_document = architecture_truth_header + "".join(file_contents)

    for out_path in output_paths:
        with open(out_path, 'w', encoding='utf-8') as out:
            out.write(full_document)
        print(f"Successfully generated {out_path} with {len(tracked_files)} files.")

if __name__ == '__main__':
    main()
