CREATE TABLE "ManualJScenario" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'whole',
    "climate" JSONB NOT NULL DEFAULT '{}',
    "wholeZone" JSONB NOT NULL DEFAULT '{}',
    "zones" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualJScenario_pkey" PRIMARY KEY ("id")
);
