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

    output_path = 'architecture_and_souce.md'

    architecture_truth_header = """# UniCheatSheet AI: Comprehensive Architecture, Ground Truth, and Complete Source Code

> **Generated Document**: Complete System Architecture, Operational Ground Truth, and Exact Codebase Reproduction.
> **Repository**: [UniCheatSheetAI](https://github.com/AyushM1701/UniCheatSheetAI.git)

---

## 1. Executive Summary & Purpose

UniCheatSheet AI is an academic retrieval-augmented generation (RAG) assistant purpose-built for university students. It directly indexes study materials (lecture slides, typed lecture notes, textbook chapters, and past-year exam questions / PYQs) to provide:
1. **Direct Answers with Exact Citations**: Answering student queries with strict grounding, precise chunk citations, page numbers, and original document references.
2. **Past Exam Question (PYQ) Exploration**: Parsing, unit classification, and mark breakdown of university examination papers.
3. **Course & Semester Scoping**: Restricting student queries strictly to materials belonging to courses they are enrolled in or entitled to access.
4. **Offline / Low-Resource Capability**: Using CPU-friendly local ONNX embeddings (`all-MiniLM-L6-v2`, 384 dimensions) and pluggable LLM backends (Google Gemini API with Ollama fallback).

---

## 2. Core Architecture & System Design

```
+---------------------------------------------------------------------------------+
|                                 UniCheatSheet.com                               |
|                  (Existing Auth, Semester & Payment Authority)                  |
+---------------------------------------------------------------------------------+
                                         |
                                         | 1. Issues RS256 JWT (exp <= 15m)
                                         |    Claims: sub, semester, courses[]
                                         v
+---------------------------------------------------------------------------------+
|                                  Fastify API                                    |
|                              (apps/api : 4000)                                  |
|   +-------------------------------------------------------------------------+   |
|   | Access Context Guard: Validates JWT signature / dev-context fallback    |   |
|   | Course Scoping: Rejects queries outside student's authorized course set |   |
|   +-------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------+
           |                                                      ^
           | 2. Passes AccessContext                              |
           v                                                      | 5. Stream Tokens
+-------------------------------------------------------------+   |    & Citations
|                    packages/ai-core                         |   |
|  - Query Router (General vs Conceptual vs PYQ Search)       |   |
|  - Context Builder (Course filter + Top-K chunk injection)  |---+
|  - Citation Engine (Regex citation detection [DocX p.Y])    |
|  - Prompt Builder (Strict academic persona & anti-hallucin.)|
+-------------------------------------------------------------+
           |                                      |
           | 3. Local Embedding                   | 4. Generation Prompt
           v                                      v
+-----------------------+              +-----------------------------+
|  packages/embeddings  |              |    packages/providers/llm   |
|   all-MiniLM-L6-v2    |              | - Google Gemini 3.5 / 2.5   |
|   (384-dim ONNX CPU)  |              | - Ollama (Local llama3)     |
+-----------------------+              | - Mock LLM (CI / Tests)     |
           |                           +-----------------------------+
           | 3b. Cosine Similarity Match
           v
+-------------------------------------------------------------+
|                     packages/database                       |
|           PostgreSQL + pgvector (HNSW / Cosine)             |
|  Tables: SourceFile, DocumentChunk, Conversation, Message   |
+-------------------------------------------------------------+
```

### 2.1 Package Breakdown & Responsibilities
- **`apps/api`**: Fastify REST / SSE service exposing `/api/chat/stream`, `/api/chat`, `/api/courses`, `/api/pyqs`, and `/api/health`.
- **`apps/playground`**: Next.js 15 (React 19, Tailwind CSS) chat interface featuring markdown rendering, KaTeX math expressions, interactive citation badges, slide-out source drawer, and scope selector.
- **`packages/ai-core`**: Core orchestration pipeline; manages chat lifecycle, memory, citation resolution, and prompt formatting.
- **`packages/database`**: Prisma client wrapper and database migration definitions.
- **`packages/document-processing`**: PDF text extraction, markdown normalization, hierarchical heading chunking, exam question regex extraction, and TrOCR OCR fallback.
- **`packages/drive-sync`**: Downloader and synchronizer syncing university study materials from Google Drive via `rclone`.
- **`packages/embeddings`**: Transformer pipeline wrapping ONNX runtime for local inference.
- **`packages/indexing`**: Ingestion worker that parses PDFs, computes chunk embeddings, and synchronizes the vector database.
- **`packages/ingestion`**: Batch pipeline orchestrator for reconciling catalog records against filesystem files.
- **`packages/providers/llm`**: Pluggable provider layer for LLMs with unified streaming interfaces.
- **`packages/retrieval`**: SQL / pgvector retrieval layer executing cosine distance searches scoped to valid course IDs.
- **`packages/shared`**: Cross-cutting utilities (logging, errors, types).
- **`packages/unicheatsheet-source`**: Catalog parser and scanner for the UniCheatSheet website structure.

---

## 3. Operational Ground Truth & Critical Realities

1. **Authentication & Entitlements**:
   - The AI backend does **not** store student passwords or process payments.
   - It relies entirely on short-lived RS256 JWTs signed by the parent site (`UniCheatSheet.com`), transmitting the student's `semester` and allowed `courses` list.
   - For standalone development, `dev-context.json` provides simulated entitlements.
2. **Vector Space & Similarity Search**:
   - Embeddings use `sentence-transformers/all-MiniLM-L6-v2` producing normalized 384-dimensional vectors.
   - Database vector distance metric is cosine distance (`<=>`), indexed via `pgvector` HNSW indexes for sub-millisecond retrieval.
3. **Citation & Anti-Hallucination**:
   - The LLM is strictly instructed never to fabricate sources. Every claim must refer to injected chunks formatted as `[Doc <id>, p. <page>]`.
   - The `citation-engine` catches and validates citation markers in real-time streaming chunks, linking them to source files and page numbers.
4. **OCR Fallback**:
   - For scanned exam papers or handwritten slides where standard PDF text extractors return zero or garbled text, `packages/document-processing/src/ocr.ts` delegates pages to `scripts/ocr_page.py` (TrOCR) to ensure no course materials are lost.

---

## 4. Complete Codebase Index

Below is the exhaustive, verbatim content of every tracked file in this repository.

"""

    with open(output_path, 'w', encoding='utf-8') as out:
        out.write(architecture_truth_header)

        for rel_path in tracked_files:
            abs_path = os.path.abspath(rel_path)
            out.write(f"\n\n{'='*80}\n")
            out.write(f"## File: `{rel_path}`\n")
            out.write(f"{'='*80}\n\n")

            if rel_path.endswith(('.pdf', '.webp')):
                file_size = os.path.getsize(abs_path)
                sha = get_file_hash(abs_path)
                out.write(f"> **Binary Asset**: `{rel_path}`\n")
                out.write(f"> **File Size**: {file_size} bytes\n")
                out.write(f"> **SHA-256**: `{sha}`\n\n")
                out.write("*(Binary asset content omitted from text rendering)*\n")
                continue

            lang = get_language(rel_path)
            try:
                with open(abs_path, 'r', encoding='utf-8', errors='replace') as sf:
                    content = sf.read()

                # Choose fence that won't collide with backticks inside content
                fence = '```'
                if '```' in content:
                    fence = '````'
                if '````' in content:
                    fence = '`````'

                out.write(f"{fence}{lang}\n")
                out.write(content)
                if not content.endswith('\n'):
                    out.write('\n')
                out.write(f"{fence}\n")
            except Exception as e:
                out.write(f"*Error reading file: {e}*\n")

    print(f"Successfully generated {output_path} with {len(tracked_files)} files.")

if __name__ == '__main__':
    main()
