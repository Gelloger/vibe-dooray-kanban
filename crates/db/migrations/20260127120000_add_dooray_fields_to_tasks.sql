-- Add Dooray integration fields to tasks table
ALTER TABLE tasks ADD COLUMN dooray_task_id TEXT;
ALTER TABLE tasks ADD COLUMN dooray_project_id TEXT;
ALTER TABLE tasks ADD COLUMN dooray_task_number TEXT;  -- For branch naming (e.g., "PROJECT-123")

-- Index for lookups by Dooray task ID
CREATE INDEX idx_tasks_dooray_task_id ON tasks(dooray_task_id);
