-- CreateTable
CREATE TABLE "Detector" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'smoke',
    "location" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3),
    "replaceByDate" TIMESTAMP(3),
    "batteryType" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Detector_pkey" PRIMARY KEY ("id")
);
