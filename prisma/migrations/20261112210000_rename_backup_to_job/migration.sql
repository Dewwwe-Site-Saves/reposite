-- The table holds every queued run, and backups are about to stop being the only kind: rename it in place, rows kept.
ALTER TABLE "Backup" RENAME TO "Job";

-- SQLite cannot rename an index: the two indexes follow the table but keep their old names, so they are recreated under the names Prisma derives from the model.
DROP INDEX "Backup_siteId_queuedAt_idx";
DROP INDEX "Backup_status_idx";

-- CreateIndex
CREATE INDEX "Job_siteId_queuedAt_idx" ON "Job"("siteId", "queuedAt" DESC);

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");
