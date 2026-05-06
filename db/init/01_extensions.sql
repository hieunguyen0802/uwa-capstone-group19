-- Runs only when the postgres volume is empty.
-- Keep first-boot SQL idempotent and safe for team setup.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
