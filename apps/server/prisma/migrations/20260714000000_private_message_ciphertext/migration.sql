-- AES-GCM envelopes are larger than their plaintext and must not be truncated.
ALTER TABLE "Message" ALTER COLUMN "text" TYPE VARCHAR(4096);
