-- CreateTable
CREATE TABLE "SurveyAnalysis" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyAnalysis_surveyId_createdAt_idx" ON "SurveyAnalysis"("surveyId", "createdAt");

-- AddForeignKey
ALTER TABLE "SurveyAnalysis" ADD CONSTRAINT "SurveyAnalysis_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
