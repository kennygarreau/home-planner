-- Fold BacklogItem into Project as status = 'backlog'
INSERT INTO "Project" ("id", "name", "category", "status", "estimatedCost", "actualCost", "roiBenchmark", "notes", "priority", "createdAt", "updatedAt")
SELECT "id", "name", "category", 'backlog', "estimatedCost", 0, "roiBenchmark", "notes", "priority", "createdAt", "updatedAt"
FROM "BacklogItem";

DROP TABLE "BacklogItem";
