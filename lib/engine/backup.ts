import fs from 'node:fs';
import path from 'node:path';
import { errorMessage, isCancellation, throwIfAborted } from './cancel';
import { DUMP_FILE_NAME, dumpDatabase } from './dump';
import { commitAndTag, ensureRepo, formatTag, push, type GitContext } from './git';
import { createRelease, formatReleaseBody, parseRepoUrl } from './github';
import { createLogger } from './logger';
import { createRemoteFactory, openClient, remoteRootDir, type RemoteClient } from './remote';
import { updateSharePointItem } from './sharepoint';
import { GITIGNORE_TEMPLATE, isBackupArtifact, syncFiles } from './sync';
import type {
    BackupOptions,
    BackupOutcome,
    BackupResult,
    GithubConfig,
    Logger,
    SharePointConfig,
    SiteConfig,
} from './types';

/** Workflow the v1 engine committed into every backup repo; Releases are now created by the app. */
const LEGACY_WORKFLOW = path.join('.github', 'workflows', 'auto-tagged-release.yml');
const LEGACY_DUMP = /^db_.*\.sql$/;

/**
 * One full backup of one site. Never throws: the outcome is in `result.status`, with
 * `errorMessage` and the complete log. Each step checks the abort signal.
 */
export async function runBackup(
    site: SiteConfig,
    github: GithubConfig,
    sharepoint: SharePointConfig | null,
    options: BackupOptions,
): Promise<BackupResult> {
    const { localRoot, signal } = options;
    const log = createLogger(`[${site.domain}]`, options.onLog);
    const startedAt = new Date();
    const stats = { filesDownloaded: 0, filesUnchanged: 0, filesDeleted: 0, dumpSizeBytes: 0 };
    let commitSha: string | null = null;
    let tag: string | null = null;
    let releaseUrl: string | null = null;
    let status: BackupOutcome = 'success';
    let errorText: string | null = null;

    const gitCtx: GitContext = {
        cwd: localRoot,
        name: github.name,
        email: github.email,
        token: github.token,
        signal,
    };
    const factory = createRemoteFactory(site);
    const rootDir = remoteRootDir(site);

    try {
        // 1. Local clone on the remote default branch, clean tree.
        await ensureRepo(gitCtx, site.repoUrl, log);
        throwIfAborted(signal);
        prepareLocalTree(localRoot, site, log);

        // 2 + 3. Leftovers from an interrupted run, then the dump, on one connection unless the cleanup lost it: a listing that fails right after login is usually a socket the host dropped, and the dump would only inherit a dead client.
        let client = await openClient(factory, { log, signal });
        try {
            if (!(await removeRemoteLeftovers(client, rootDir, log))) {
                await client.close().catch(() => undefined);
                throwIfAborted(signal);
                log.info('Reconnecting for the dump...');
                client = await openClient(factory, { log, signal });
            }
            throwIfAborted(signal);
            const dump = await dumpDatabase(
                site,
                client,
                path.join(localRoot, DUMP_FILE_NAME),
                log,
                signal,
            );
            stats.dumpSizeBytes = dump.sizeBytes;
        } finally {
            await client.close().catch(() => undefined);
        }
        throwIfAborted(signal);

        // 4. Files.
        const sync = await syncFiles(factory, localRoot, rootDir, {
            mode: options.fullDownload ? 'full' : 'incremental',
            log,
            signal,
        });
        stats.filesDownloaded = sync.downloaded;
        stats.filesUnchanged = sync.unchanged;
        stats.filesDeleted = sync.deleted;
        throwIfAborted(signal);

        // 5 + 6. Snapshot and its Release.
        if (options.skipGit) {
            log.info('Skipping commit and push');
        } else {
            const now = new Date();
            const commit = await commitAndTag(
                gitCtx,
                `Backup ${site.domain} ${now.toISOString()}`,
                formatTag(now),
                log,
            );
            commitSha = commit.commitSha;
            tag = commit.tag;
            await push(gitCtx, tag, log);
            if (tag && commitSha) {
                releaseUrl = await publishRelease(
                    site,
                    github,
                    tag,
                    {
                        domain: site.domain,
                        date: now,
                        triggerType: options.triggerType,
                        ...stats,
                        durationMs: Date.now() - startedAt.getTime(),
                        commitSha,
                    },
                    log,
                );
            }
        }
    } catch (error) {
        if (isCancellation(error)) {
            status = 'cancelled';
            errorText = 'Cancelled by user';
            log.warn('Backup cancelled');
        } else {
            status = 'error';
            errorText = errorMessage(error);
            log.error(`Backup failed: ${errorText}`);
        }
    }

    // 7. Tracking list, only for a complete snapshot.
    if (status === 'success' && sharepoint && site.spListItemId) {
        try {
            await updateSharePointItem(sharepoint, site.spListItemId, log);
        } catch (error) {
            log.warn(`SharePoint update failed: ${errorMessage(error)}`);
        }
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const seconds = Math.round(durationMs / 1000);
    log.info(`Backup ${status.toUpperCase()} in ${Math.floor(seconds / 60)}m ${seconds % 60}s`);

    return {
        status,
        startedAt,
        finishedAt,
        durationMs,
        ...stats,
        commitSha,
        tag,
        releaseUrl,
        errorMessage: errorText,
        log: log.text(),
    };
}

/** Removes what v1 left in the clone and makes sure the `.gitignore` exists. */
function prepareLocalTree(localRoot: string, site: SiteConfig, log: Logger): void {
    const workflow = path.join(localRoot, LEGACY_WORKFLOW);
    if (fs.existsSync(workflow)) {
        log.info('Removing legacy release workflow');
        fs.rmSync(workflow);
        // turbopackIgnore: `path.dirname` of a runtime path reads as "anywhere" to the build-time tracer, which then traces the whole project.
        for (const dir of [path.dirname(workflow), path.join(localRoot, '.github')]) {
            if (
                fs.existsSync(/*turbopackIgnore: true*/ dir) &&
                fs.readdirSync(/*turbopackIgnore: true*/ dir).length === 0
            ) {
                fs.rmdirSync(dir);
            }
        }
    }

    const webRoot = path.join(localRoot, site.webRootPath);
    if (fs.existsSync(webRoot)) {
        for (const name of fs.readdirSync(webRoot)) {
            if (LEGACY_DUMP.test(name)) {
                log.info(`Removing legacy dump ${name}`);
                fs.rmSync(path.join(webRoot, name));
            }
        }
    }

    const gitignore = path.join(localRoot, '.gitignore');
    if (!fs.existsSync(gitignore)) {
        log.info('Adding .gitignore');
        fs.writeFileSync(gitignore, GITIGNORE_TEMPLATE);
    }
}

/** Dump, script or token file left on the web root by an interrupted run. Returns false when the cleanup failed: the connection is not to be trusted any more. */
async function removeRemoteLeftovers(
    client: RemoteClient,
    rootDir: string,
    log: Logger,
): Promise<boolean> {
    try {
        const leftovers = (await client.list(rootDir)).filter(
            (entry) => entry.type === 'file' && isBackupArtifact(path.posix.basename(entry.path)),
        );
        for (const entry of leftovers) {
            log.info(`Removing leftover ${entry.path}`);
            await client.remove(entry.path);
        }
        return true;
    } catch (error) {
        if (isCancellation(error)) throw error;
        log.warn(`Could not clean up leftovers: ${errorMessage(error)}`);
        return false;
    }
}

/** A failed Release is a warning: the snapshot is pushed, only its shortcut is missing. */
async function publishRelease(
    site: SiteConfig,
    github: GithubConfig,
    tag: string,
    stats: Parameters<typeof formatReleaseBody>[0],
    log: Logger,
): Promise<string | null> {
    try {
        const url = await createRelease(github.token, parseRepoUrl(site.repoUrl), tag, {
            name: `Backup ${stats.date.toISOString().slice(0, 19).replace('T', ' ')} UTC`,
            body: formatReleaseBody(stats),
        });
        log.info(`Release created: ${url}`);
        return url;
    } catch (error) {
        log.warn(`Release creation failed: ${errorMessage(error)}`);
        return null;
    }
}
