-- Per-job AI budget. Rows created before this migration have no budget (no limits) and no recorded cost.
ALTER TABLE jobs ADD COLUMN ai_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN budget_max_cost_usd REAL;
ALTER TABLE jobs ADD COLUMN budget_deadline TEXT;
