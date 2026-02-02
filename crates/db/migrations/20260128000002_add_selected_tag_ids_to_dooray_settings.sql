-- Add selected_tag_ids column to dooray_settings for tag filtering during sync
-- Stores JSON array of tag IDs to filter when syncing tasks
ALTER TABLE dooray_settings ADD COLUMN selected_tag_ids TEXT;
