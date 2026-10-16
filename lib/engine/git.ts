import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { BackupCancelledError } from './cancel';
import type { Logger } from './types';

const execFileAsync = promisify(execFile);

/** Commit author name when `Settings.githubName` is empty. */
export const DEFAULT_AUTHOR_NAME = 'Reposite';
/** Generous: a first push of a large site prints a lot, and stdout of fetch/push is discarded anyway. */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Inline credential helper: git runs it through `sh` and reads `username=` / `password=`
 * from its stdout. The token only ever lives in the GIT_BACKUP_TOKEN env var of that
 * process, so it never appears in a URL, in `.git/config`, in `ps` or in an error message.
 * The empty `credential.helper=` entry before it resets the helper list, so the machine's
 * own helpers (osxkeychain, libsecret) are neither consulted nor asked to store anything.
 */
const CREDENTIAL_HELPER =
    '!f() { echo username=x-access-token; echo "password=$GIT_BACKUP_TOKEN"; }; f';

export interface GitContext {
    /** Working directory of the clone. */
    cwd: string;
    /** Commit author name. */
    name: string;
    /** Commit author email. */
    email: string;
    /** GitHub token, or null for remotes that need no authentication (tests, local paths). */
    token: string | null;
    signal?: AbortSignal;
}

export class GitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GitError';
    }
}

type ExecError = Error & { code?: number | string; stderr?: string; killed?: boolean };

/**
 * Runs one git command with the identity and credentials passed per invocation. Arguments
 * are an array (no shell), so site names and URLs can never be interpreted as commands.
 */
export async function git(args: string[], ctx: GitContext, cwd = ctx.cwd): Promise<string> {
    const config = [
        '-c',
        `user.name=${ctx.name}`,
        '-c',
        `user.email=${ctx.email}`,
        '-c',
        'http.postBuffer=157286400',
        '-c',
        'credential.helper=',
        '-c',
        `credential.helper=${CREDENTIAL_HELPER}`,
    ];
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_BACKUP_TOKEN: ctx.token ?? '' };
    try {
        const { stdout } = await execFileAsync('git', [...config, ...args], {
            cwd,
            env,
            maxBuffer: MAX_BUFFER,
            signal: ctx.signal,
        });
        return stdout;
    } catch (error) {
        throw toGitError(error as ExecError, args[0] ?? 'git', ctx.token);
    }
}

/** Builds an error from stderr only: the command line (and its environment) never leaks. */
function toGitError(error: ExecError, command: string, token: string | null): Error {
    if (error.name === 'AbortError') return new BackupCancelledError();
    let detail = (error.stderr ?? '').trim();
    if (token) detail = detail.replaceAll(token, '***');
    if (detail.length > 1000) detail = `${detail.slice(0, 1000)}…`;
    if (error.code === 'ENOENT') return new GitError('git executable not found');
    return new GitError(
        `git ${command} failed${detail ? `: ${detail}` : ` (exit code ${String(error.code)})`}`,
    );
}

/** `YYYYMMDD-HHmmss` in UTC: sortable, unique within a second. */
export function formatTag(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
    const t = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
    return `${d}-${t}`;
}

/**
 * Makes `ctx.cwd` a clone of `repoUrl` on the remote default branch, with a clean tree.
 * Clones when the folder or its `.git` is missing. Otherwise resets the remote URL (drops
 * any token left in an old clone), fetches and hard-resets to the remote branch. A
 * transient fetch failure throws and keeps the clone; only an unreadable `.git` is wiped.
 */
export async function ensureRepo(ctx: GitContext, repoUrl: string, log: Logger): Promise<void> {
    // turbopackIgnore: the build-time tracer would otherwise glob every `.git` folder of the project.
    const gitDir = path.join(/*turbopackIgnore: true*/ ctx.cwd, '.git');
    if (!fs.existsSync(gitDir)) {
        if (fs.existsSync(ctx.cwd)) {
            log.warn(`${ctx.cwd} exists without a .git folder, replacing it with a fresh clone`);
            fs.rmSync(ctx.cwd, { recursive: true, force: true });
        }
        log.info('Cloning repository...');
        fs.mkdirSync(path.dirname(ctx.cwd), { recursive: true });
        await git(['clone', '--quiet', repoUrl, ctx.cwd], ctx, path.dirname(ctx.cwd));
        return;
    }

    log.info('Fetching repository...');
    await git(['remote', 'set-url', 'origin', repoUrl], ctx);
    await git(['fetch', '--quiet', '--prune', 'origin'], ctx);
    // Discard any leftover from an interrupted run before switching branch.
    await git(['reset', '--quiet', '--hard'], ctx);
    // `reset` only restores tracked files. An untracked leftover — a dump written by a run that
    // never reached its commit — makes the checkout below abort rather than overwrite it. Ignored
    // files are kept on purpose: the `.gitignore` of a clone lists what is never committed and
    // would otherwise be downloaded again on every run.
    await git(['clean', '--quiet', '-fd'], ctx);

    const branch = await remoteDefaultBranch(ctx);
    if (!branch) {
        log.warn('Remote has no commits yet, keeping the local tree as is');
        return;
    }
    await git(['checkout', '--quiet', '-B', branch, `origin/${branch}`], ctx);
}

/** Name of the remote default branch, or null when the remote is empty. */
async function remoteDefaultBranch(ctx: GitContext): Promise<string | null> {
    try {
        await git(['remote', 'set-head', 'origin', '--auto'], ctx);
        const ref = (
            await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], ctx)
        ).trim();
        return ref.replace(/^origin\//, '') || null;
    } catch {
        return null;
    }
}

export interface CommitResult {
    /** Short SHA of HEAD after the step, null on an unborn branch with nothing to commit. */
    commitSha: string | null;
    /** The created tag, null when there was nothing to commit. */
    tag: string | null;
}

/**
 * Stages everything and commits with `tag` when the tree changed. With a clean tree no
 * commit and no tag are created, so a run that downloaded nothing leaves no empty snapshot.
 */
export async function commitAndTag(
    ctx: GitContext,
    message: string,
    tag: string,
    log: Logger,
): Promise<CommitResult> {
    await git(['add', '--all'], ctx);
    const status = await git(['status', '--porcelain'], ctx);
    if (status.trim() === '') {
        log.info('Nothing to commit');
        return { commitSha: await headSha(ctx), tag: null };
    }
    await git(['commit', '--quiet', '-m', message], ctx);
    const uniqueTag = await availableTag(ctx, tag);
    await git(['tag', uniqueTag], ctx);
    const commitSha = await headSha(ctx);
    log.info(`Committed ${commitSha ?? ''} and tagged ${uniqueTag}`);
    return { commitSha, tag: uniqueTag };
}

/** `tag`, or `tag-2`, `tag-3`... when a snapshot already took that name (two runs within a second). */
async function availableTag(ctx: GitContext, tag: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
        const candidate = attempt === 1 ? tag : `${tag}-${attempt}`;
        const existing = await git(['tag', '--list', candidate], ctx);
        if (existing.trim() === '') return candidate;
    }
}

/** Pushes the current branch and, when given, one tag, in a single push. */
export async function push(ctx: GitContext, tag: string | null, log: Logger): Promise<void> {
    const refs = ['HEAD', ...(tag ? [`refs/tags/${tag}`] : [])];
    await git(['push', '--quiet', 'origin', ...refs], ctx);
    log.info(`Pushed ${refs.join(' and ')}`);
}

/** Short SHA of HEAD, null on an unborn branch. */
export async function headSha(ctx: GitContext): Promise<string | null> {
    try {
        return (await git(['rev-parse', '--short', 'HEAD'], ctx)).trim() || null;
    } catch {
        return null;
    }
}
