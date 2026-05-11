CREATE TABLE "ElecScenario" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "panelAmps" INTEGER NOT NULL DEFAULT 200,
    "loads" JSONB NOT NULL DEFAULT '[]',
    "subPanels" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ElecScenario_pkey" PRIMARY KEY ("id")
);
