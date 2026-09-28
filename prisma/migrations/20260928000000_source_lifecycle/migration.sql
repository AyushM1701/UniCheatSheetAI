ALTER TABLE source_files ADD COLUMN last_checked_at TIMESTAMP(3);
ALTER TABLE source_files ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX source_files_provider_remote_root_active_idx ON source_files(provider, remote_root, active);
ALTER TABLE source_files ALTER COLUMN modified_at DROP NOT NULL;
CREATE UNIQUE INDEX source_files_provider_remote_file_id_key ON source_files(provider, remote_file_id);
