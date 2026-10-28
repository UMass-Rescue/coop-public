ALTER TABLE hash_banks
    ADD COLUMN hma_instance VARCHAR(16) NOT NULL DEFAULT 'DEFAULT',
    ADD CONSTRAINT hash_banks_hma_instance_check
    CHECK (hma_instance IN ('DEFAULT', 'CLIP'));

COMMENT ON COLUMN hash_banks.hma_instance IS
    'Which HMA deployment holds this bank: DEFAULT (stock HMA: PDQ images, MD5 video) or CLIP (the optional CLIP instance). Fixed at creation.';
