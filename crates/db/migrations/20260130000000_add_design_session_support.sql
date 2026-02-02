-- Add design session support
-- 1. Add design_session_id to tasks table
-- 2. Make workspace_id nullable in sessions table (for design sessions without workspace)

-- Step 1: Add design_session_id to tasks
ALTER TABLE tasks ADD COLUMN design_session_id TEXT;
CREATE INDEX idx_tasks_design_session_id ON tasks(design_session_id);

-- Step 2: Make workspace_id nullable in sessions
-- SQLite doesn't support ALTER COLUMN, so we need to rebuild the table

-- End auto-transaction for PRAGMA
COMMIT;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Create new sessions table with nullable workspace_id
CREATE TABLE sessions_new (
    id              BLOB PRIMARY KEY,
    workspace_id    BLOB,  -- Now nullable for design sessions
    executor        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Copy existing data
INSERT INTO sessions_new (id, workspace_id, executor, created_at, updated_at)
SELECT id, workspace_id, executor, created_at, updated_at FROM sessions;

-- Drop old table and rename new one
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- Recreate indexes
CREATE INDEX idx_sessions_workspace_id ON sessions(workspace_id);

-- Verify foreign key constraints
PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround: start empty transaction for sqlx to close gracefully
BEGIN TRANSACTION;
