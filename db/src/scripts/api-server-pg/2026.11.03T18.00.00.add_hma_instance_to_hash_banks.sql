-- Safe to run again: an earlier name of this migration may already have been
-- applied to a database, so every statement checks first.
ALTER TABLE hash_banks
    ADD COLUMN IF NOT EXISTS hma_instance VARCHAR(16) NOT NULL DEFAULT 'DEFAULT';

ALTER TABLE hash_banks
    DROP CONSTRAINT IF EXISTS hash_banks_hma_instance_check,
    ADD CONSTRAINT hash_banks_hma_instance_check
    CHECK (hma_instance IN ('DEFAULT', 'CLIP'));

COMMENT ON COLUMN hash_banks.hma_instance IS
    'Which HMA deployment holds this bank: DEFAULT (stock HMA: PDQ images, MD5 video) or CLIP (the optional CLIP instance). Fixed at creation.';
