-- Add dooray_domain column to store the organization's Dooray domain (e.g., "nhnent.dooray.com")
ALTER TABLE dooray_settings ADD COLUMN dooray_domain TEXT;
