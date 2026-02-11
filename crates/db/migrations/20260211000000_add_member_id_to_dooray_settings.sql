-- Add member_id column to store the current user's Dooray organizationMemberId
ALTER TABLE dooray_settings ADD COLUMN member_id TEXT;
