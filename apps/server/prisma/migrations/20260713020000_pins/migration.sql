CREATE TABLE "PinnedMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "roomId" "RoomId" NOT NULL,
  "messageId" UUID NOT NULL,
  "pinnedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PinnedMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PinnedMessage_roomId_key" ON "PinnedMessage"("roomId");
CREATE UNIQUE INDEX "PinnedMessage_messageId_key" ON "PinnedMessage"("messageId");
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_pinnedBy_fkey" FOREIGN KEY ("pinnedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
