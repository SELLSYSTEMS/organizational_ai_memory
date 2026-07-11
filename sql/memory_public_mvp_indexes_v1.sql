CREATE UNIQUE INDEX IF NOT EXISTS ux_memory_facts_one_current
    ON memory.facts (thread_id, subject_key, predicate)
    WHERE is_current = true AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_retrieval_events_thread_time
    ON memory.retrieval_events (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_summaries_active_latest
    ON memory.thread_summaries (thread_id, summary_scope, updated_at DESC)
    WHERE is_active = true;
