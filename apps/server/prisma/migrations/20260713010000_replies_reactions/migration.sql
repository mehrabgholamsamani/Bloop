ALTER TABLE "Message" ADD COLUMN "parentId" UUID;
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Reaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "emoji" VARCHAR(16) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Reaction_messageId_userId_emoji_key" ON "Reaction"("messageId", "userId", "emoji");
CREATE INDEX "Reaction_messageId_idx" ON "Reaction"("messageId");
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
