-- Jobs come in kinds: every existing row is a backup.
ALTER TABLE "Job" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'backup';

-- What runs on a site, as last read from its files, and when and whether to read it.
ALTER TABLE "Site" ADD COLUMN "cms" TEXT;
ALTER TABLE "Site" ADD COLUMN "cmsVersion" TEXT;
ALTER TABLE "Site" ADD COLUMN "inventoryAt" DATETIME;
ALTER TABLE "Site" ADD COLUMN "inventoryEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Site" ADD COLUMN "inventoryCronSchedule" TEXT;

ALTER TABLE "Settings" ADD COLUMN "defaultInventoryCron" TEXT NOT NULL DEFAULT '0 4 * * *';
ALTER TABLE "Settings" ADD COLUMN "inventoryRetentionDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Settings" ADD COLUMN "notifyOnInventoryError" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SiteComponent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    CONSTRAINT "SiteComponent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteComponent_siteId_type_slug_key" ON "SiteComponent"("siteId", "type", "slug");
