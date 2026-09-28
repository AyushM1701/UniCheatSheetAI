CREATE TABLE source_files (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  remote_root TEXT NOT NULL,
  remote_file_id TEXT,
  remote_path TEXT NOT NULL,
  local_path TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  size BIGINT NOT NULL,
  remote_hash TEXT,
  local_hash TEXT,
  modified_at TIMESTAMP(3) NOT NULL,
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  indexed_at TIMESTAMP(3),
  sync_status TEXT NOT NULL DEFAULT 'pending',
  index_status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  course_id TEXT NOT NULL REFERENCES courses(id),
  academic_document_id TEXT UNIQUE REFERENCES academic_documents(id) ON DELETE SET NULL,
  CONSTRAINT source_files_provider_remote_root_remote_path_key UNIQUE(provider, remote_root, remote_path)
);
CREATE INDEX source_files_course_id_sync_status_idx ON source_files(course_id, sync_status);
