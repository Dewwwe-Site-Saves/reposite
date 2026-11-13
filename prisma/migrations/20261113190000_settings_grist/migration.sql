-- Where the state of the sites is pushed: a Grist document, its sites table and, optionally, its components table.
ALTER TABLE "Settings" ADD COLUMN "gristUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "gristApiKeyEnc" TEXT;
ALTER TABLE "Settings" ADD COLUMN "gristDocId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "gristSitesTable" TEXT;
ALTER TABLE "Settings" ADD COLUMN "gristComponentsTable" TEXT;
