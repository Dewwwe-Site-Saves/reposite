-- Outcome of the last push of a site to Grist: when it last went through, and why the last attempt failed.
ALTER TABLE "Site" ADD COLUMN "gristSyncedAt" DATETIME;
ALTER TABLE "Site" ADD COLUMN "gristSyncError" TEXT;
