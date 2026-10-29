ALTER TABLE org_settings
    ADD COLUMN IF NOT EXISTS has_clip_hashing_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN org_settings.has_clip_hashing_enabled IS
    'Whether this org hashes submitted images with CLIP (semantic matching) and may use CLIP hash banks. Only takes effect when the deployment has the optional CLIP HMA instance.';
