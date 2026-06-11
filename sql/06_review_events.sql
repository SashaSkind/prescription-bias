-- 06_review_events.sql
-- ClickHouse landing table for the OLTP->OLAP demo. scripts/pipe_pg_to_ch.py polls the
-- Postgres drug_review watchlist and appends changed rows here, so analysts' review
-- decisions (flagged/reviewing/cleared/escalated) become queryable alongside the data.
--
-- Append-only event log: each poll inserts the current state of a changed row, stamped
-- with synced_at. Latest state per review id = argMax(... , synced_at).

CREATE TABLE IF NOT EXISTS rx.review_events
(
    review_id   UInt64,
    drug_key    String,
    npi         UInt64,
    pay_amount  Float64,
    avg_claims  Float64,
    status      LowCardinality(String),
    assigned_to String,
    updated_at  DateTime,
    synced_at   DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (review_id, synced_at);

-- Latest state per review:
-- SELECT review_id, argMax(status, synced_at) AS status,
--        argMax(drug_key, synced_at) AS drug_key, max(updated_at) AS updated_at
-- FROM rx.review_events GROUP BY review_id ORDER BY review_id;
