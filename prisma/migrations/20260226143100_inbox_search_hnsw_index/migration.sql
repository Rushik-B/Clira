-- Phase 1 / Migration B: ANN index
-- NOTE: this migration is intentionally separated from table creation.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "InboxSearchChunk_embedding_hnsw_idx"
ON "InboxSearchChunk"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE "embedding" IS NOT NULL;
