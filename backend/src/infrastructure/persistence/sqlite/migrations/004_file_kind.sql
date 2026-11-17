-- Classification of covered files (see SourceFileClassifier): re-export-only files are never improvement candidates.
ALTER TABLE file_coverages ADD COLUMN kind TEXT NOT NULL DEFAULT 'module' CHECK (kind IN ('module', 're-export-only'));
