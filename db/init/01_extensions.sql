-- Runs only when the postgres volume is empty.
-- Keep first-boot SQL idempotent and safe for team setup.
-- Kept for SQL-side UUID generation in ad-hoc scripts/reporting if needed.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
