-- Global Dooray settings table for storing API token and selected project
CREATE TABLE dooray_settings (
    id TEXT PRIMARY KEY NOT NULL,
    dooray_token TEXT NOT NULL,
    selected_project_id TEXT,
    selected_project_name TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
