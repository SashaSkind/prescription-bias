-- watchlist.sql — the OLTP side. Run against Postgres.
-- A compliance-style review queue: each row is a flagged prescriber×drug outlier that a
-- human triages (flagged -> reviewing -> cleared/escalated). seed_watchlist.py fills it
-- from ClickHouse outliers; pipe_pg_to_ch.py streams status changes back to ClickHouse.

CREATE TYPE review_status AS ENUM ('flagged', 'reviewing', 'cleared', 'escalated');

CREATE TABLE IF NOT EXISTS drug_review (
    id          BIGSERIAL PRIMARY KEY,
    drug_key    TEXT      NOT NULL,
    npi         BIGINT    NOT NULL,
    pay_amount  NUMERIC,
    avg_claims  NUMERIC,
    status      review_status DEFAULT 'flagged',
    assigned_to TEXT,
    updated_at  TIMESTAMPTZ   DEFAULT now(),
    UNIQUE (drug_key, npi)
);

-- Keep updated_at fresh on any change, so the CDC pipe can poll on it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_drug_review_touch ON drug_review;
CREATE TRIGGER trg_drug_review_touch
    BEFORE UPDATE ON drug_review
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
