-- CreateTable
CREATE TABLE "FloorPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "ceilingHt" DOUBLE PRECISION NOT NULL DEFAULT 9,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);
