CREATE TABLE "ModerationAction" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "kind" VARCHAR(16) NOT NULL, "expiresAt" TIMESTAMP(3), "reason" VARCHAR(300), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ModerationAction_userId_kind_expiresAt_idx" ON "ModerationAction"("userId", "kind", "expiresAt");
CREATE TABLE "Report" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "reporterId" UUID NOT NULL, "messageId" UUID, "reason" VARCHAR(300) NOT NULL, "status" VARCHAR(16) NOT NULL DEFAULT 'open', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Report_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
CREATE TABLE "AdminAuditLog" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "action" VARCHAR(64) NOT NULL, "targetId" TEXT, "details" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id"));
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
