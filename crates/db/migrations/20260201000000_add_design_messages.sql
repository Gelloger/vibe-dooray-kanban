-- Design messages for design sessions (pre-implementation planning)
-- These store the conversation history between user and AI in design mode

CREATE TABLE design_messages (
    id              BLOB PRIMARY KEY,
    session_id      BLOB NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_design_messages_session_id ON design_messages(session_id);
CREATE INDEX idx_design_messages_created_at ON design_messages(session_id, created_at);
