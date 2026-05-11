CREATE TABLE "HomeValueSnapshot" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomeValueSnapshot_pkey" PRIMARY KEY ("id")
);