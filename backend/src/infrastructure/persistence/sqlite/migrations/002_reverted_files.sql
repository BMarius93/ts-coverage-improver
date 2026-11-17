-- Non-test files the AI changed and the pipeline restored before verification (JSON array of paths).
ALTER TABLE jobs ADD COLUMN reverted_files TEXT NOT NULL DEFAULT '[]';
