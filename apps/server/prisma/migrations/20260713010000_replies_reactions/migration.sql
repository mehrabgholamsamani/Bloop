ALTER TABLE "Message" ADD COLUMN "parentId" UUID;
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Reaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "userId" UUID NOT NULL,
