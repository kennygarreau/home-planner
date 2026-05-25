CREATE TABLE "NameplateImage" (
    "id"            TEXT NOT NULL,
    "entityType"    TEXT NOT NULL,
    "entityId"      TEXT NOT NULL,
    "imageData"     TEXT NOT NULL,
    "mimeType"      TEXT NOT NULL DEFAULT 'image/jpeg',
    "extractedData" JSONB,
    "modelUsed"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NameplateImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NameplateImage_entityType_entityId_idx" ON "NameplateImage"("entityType", "entityId");
