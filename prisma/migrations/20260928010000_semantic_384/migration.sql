-- Old 1536-dimensional hash vectors are incompatible with MiniLM. Keep documents
-- and chunks, clear vectors, and reindex each source with the new model.
DROP INDEX IF EXISTS document_chunks_embedding_idx;
ALTER TABLE document_chunks DROP COLUMN embedding;
ALTER TABLE document_chunks ADD COLUMN embedding vector(384);
ALTER TABLE document_chunks ADD COLUMN page_start INTEGER;
ALTER TABLE document_chunks ADD COLUMN page_end INTEGER;
ALTER TABLE document_chunks ADD COLUMN token_estimate INTEGER;
UPDATE document_chunks SET page_start = page, page_end = page, token_estimate = CEIL(length(content) / 4.0)::INTEGER;
ALTER TABLE academic_documents ADD COLUMN page_count INTEGER;
ALTER TABLE academic_documents ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pending';
UPDATE academic_documents SET page_count = NULLIF(metadata->>'pages', '')::INTEGER;
ALTER TABLE source_files ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'other';
UPDATE source_files AS sf SET resource_type = ad.type FROM academic_documents AS ad WHERE sf.academic_document_id = ad.id;
