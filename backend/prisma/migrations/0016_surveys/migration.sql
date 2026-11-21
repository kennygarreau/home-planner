-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'baseline',
    "notes" TEXT NOT NULL DEFAULT '',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyPoint" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "roomId" TEXT,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "agentId" TEXT,
    "progress" JSONB,
    "record" JSONB,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "measuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SurveyPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyPoint_surveyId_idx" ON "SurveyPoint"("surveyId");

-- CreateIndex
CREATE INDEX "SurveyPoint_status_queuedAt_idx" ON "SurveyPoint"("status", "queuedAt");

-- AddForeignKey
ALTER TABLE "SurveyPoint" ADD CONSTRAINT "SurveyPoint_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
