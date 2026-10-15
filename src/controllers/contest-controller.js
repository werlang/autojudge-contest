import { basename } from 'node:path';
import { CONTEXT_KEYS, VIEW_STATES } from '../constants.js';
import {
    formatSubmissionStatus,
    getContestPageName,
    getProblemPageName,
    getSubmissionPageName,
    getTeamPageName,
    renderContestDashboard,
    renderProblemPage,
    renderSubmissionDetails,
    renderTeamStandingDetails,
} from '../presentation/contest-presentation.js';
import { HANDOFF_INVALID_CODE, INVALID_SETTING_CODE, REQUEST_TIMEOUT_CODE, isSessionEnded } from '../services/contest-api.js';
import { BrowserLoginError, LOGIN_FAILURE } from '../services/browser-login.js';
import { hasComparableOutput, isPassedSubmission, isPendingSubmission } from '../utils/submission-status.js';
import { resolveRouteId } from '../utils/public-id.js';
import { getContestTiming, sortProblems, summarizeProblemSubmissions } from '../utils/contest-progress.js';
import { extractPublicCases } from '../workspace/contest-public-cases.js';
import { ContestPageFiles, resolvePreviewRoot } from '../workspace/contest-page-files.js';
import { DEFAULT_POLL_INTERVAL_MS, TEAM_PANEL_REFRESH_INTERVAL_MS } from '../utils/config.js';

const SUBMISSION_POLL_TIMEOUT_MS = 2 * 60 * 1000;
// Wait before checking again a submission whose poll timed out while still pending.
const SUBMISSION_POLL_BACKOFF_MS = 30 * 1000;
// Standings refresh while the Standings view is hidden: keeps the status-bar rank fresh.
const HIDDEN_STANDINGS_REFRESH_INTERVAL_MS = 60 * 1000;
// Explorer re-render cadence so relative submission ages ("3 min ago") stay current.
const EXPLORER_RERENDER_INTERVAL_MS = 60 * 1000;
// Wait between contest-start reloads while the server still says "not
// started" (the local clock runs ahead of the server's).
const CONTEST_START_RETRY_MS = 60 * 1000;

const LAST_PROBLEM_BY_FILE_KEY = 'autojudgeContest.lastProblemByFile';
const MAX_REMEMBERED_FILES = 100;

const LOG_IN_ACTION = 'Log In';
const OPEN_SETTINGS_ACTION = 'Open Settings';
const VIEW_DETAILS_ACTION = 'View Details';
const COMPARE_OUTPUT_ACTION = 'Compare Output';
const SUBMIT_ACTION = 'Submit';
const SAVE_AND_SUBMIT_ACTION = 'Save and Submit';
const REPLACE_ACTION = 'Replace';
const REVEAL_ACTION = 'Reveal in Explorer';
const OPEN_FIRST_CASE_ACTION = 'Open First Case';

const WAITING_FOR_BROWSER_MESSAGE = 'Complete the login in your browser…';
const SESSION_ENDED_MESSAGE = 'Your session ended. Log in again (ask staff to reset your PIN if needed).';
const HANDOFF_INVALID_MESSAGE = 'The browser login link expired or was already used. Run Log In again.';
const CONTEST_NOT_STARTED_MESSAGE = 'The contest has not started yet. The problems load automatically once it starts.';
const LOGGED_OUT_MESSAGE = 'Log in to AutoJudge Contest first.';
const ALL_SOLVED_MESSAGE = 'All problems are solved.';
const SUBMIT_IN_PROGRESS_MESSAGE = 'A submission is already being sent. Wait for it to finish.';
const UPLOAD_TIMEOUT_MESSAGE = 'The upload did not finish in time. Check Contest Explorer before submitting again.';

/**
 * Write one line to the output channel at the given level. A LogOutputChannel
 * (`createOutputChannel(name, { log: true })`) gets `debug`/`info`/`warn`/`error`;
 * plain channels and test fakes fall back to `appendLine`.
 * @param {{ appendLine: (message: string) => void, debug?: Function, info?: Function, warn?: Function, error?: Function } | null | undefined} channel
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {string} message
 */
export function logToChannel(channel, level, message) {
    if (!channel) {
        return;
    }

    if (typeof channel[level] === 'function') {
        channel[level](message);
        return;
    }

    channel.appendLine(message);
}

/**
 * Create the orchestrator that bridges VS Code command handlers to the contest
 * auth/session services, the sidebar views, and the status bar.
 *
 * View state (`autojudgeContest.state`): `loggedIn` with a snapshot,
 * `loggedOut` without a stored token, `offline` when a stored token could not
 * be used because the server or the settings failed (the token is kept).
 *
 * UI functions that take actions mirror the VS Code API: the first extra
 * argument may be a `{ modal, detail }` options object, followed by the action
 * labels, and they resolve with the chosen label.
 * @param {object} options
 * @param {object} options.context extension context (`storageUri`, `workspaceState`, `secrets`)
 * @param {(command: string, ...args: unknown[]) => Promise<unknown> | unknown} [options.executeCommand]
 * @param {(uriOrPath: unknown) => Promise<{ uri: unknown }>} options.openTextDocument
 * @param {(document: unknown, options?: object) => Promise<unknown>} [options.showTextDocument]
 * @param {{ appendLine: (message: string) => void, info?: Function, warn?: Function, error?: Function }} options.outputChannel
 * @param {{ waitForHandoffCode: (cancellation?: object) => Promise<string> }} options.browserLogin starts the browser login and resolves with its one-time hand-off code
 * @param {() => number} [options.resolvePollIntervalMs] already normalized interval (`getPollIntervalMs`)
 * @param {() => string} options.resolveBaseUrl may throw an INVALID_SETTING error
 * @param {() => boolean} [options.resolveConfirmBeforeSubmit] reads `autojudgeContest.confirmBeforeSubmit` live (default true)
 * @param {{ clearStoredSession: Function, readStoredSession: Function, redeemAndLoadContest: Function, pollSubmissionResults: Function, refreshContestDetails: Function, restoreContestSession: Function, submitSolution: Function }} options.sessionApi
 * @param {(key: string, value: string | boolean) => Promise<void> | void} options.setContext
 * @param {(message: string, ...optionsAndActions: unknown[]) => Promise<string | undefined> | unknown} options.showInformationMessage
 * @param {(message: string, ...optionsAndActions: unknown[]) => Promise<string | undefined> | unknown} options.showErrorMessage
 * @param {(message: string, ...optionsAndActions: unknown[]) => Promise<string | undefined> | unknown} [options.showWarningMessage]
 * @param {(items: object[], options: object) => Promise<object | undefined> | object | undefined} [options.showQuickPick]
 * @param {<T>(task: () => Promise<T>) => Promise<T>} [options.withExplorerProgress] shows progress on the Contest Explorer view during a manual refresh
 * @param {<T>(title: string, task: (cancellation: object) => Promise<T>) => Promise<T>} options.withCancellableProgress shows a cancellable notification and passes the cancellation token to the task
 * @param {{ exportPublicCases: Function, readActiveSourceFile: Function, readSourceDocument: Function, pickExportDirectory: Function, findExistingCaseFiles: Function }} options.submissionWorkspace
 * @param {{ setSnapshot: (snapshot: object | null) => void }} options.teamsStandingsProvider
 * @param {{ setSnapshot: (snapshot: object | null) => void, getSnapshot?: () => object | null }} options.treeProvider
 * @param {{ update: (snapshot: object | null) => void, setPendingCount: (count: number) => void } | null} [options.statusBar]
 * @param {{ visible?: boolean, onDidChangeVisibility?: Function } | null} [options.explorerView]
 * @param {(submissionId: string | number) => Promise<void> | void} [options.revealSubmission] scrolls a new submission into view in the explorer (no-op by default; it owns its own error handling and logging)
 * @param {{ visible?: boolean, onDidChangeVisibility?: Function } | null} [options.teamsView]
 * @param {(fsPath: string) => unknown} [options.toFileUri] converts a file path to a `vscode.Uri` for `vscode.diff`
 * @param {{ writePage: Function, writeComparison: Function }} [options.pageFiles] generated-file writer; defaults to one under the extension storage root
 * @param {() => number} [options.now]
 * @returns {{ dispose: () => void, loginTeam: Function, logoutTeam: Function, refreshTree: Function, openContestDashboard: Function, openProblem: Function, openSubmission: Function, openTeamStanding: Function, compareSubmissionOutput: Function, submitActiveFile: Function, exportPublicCases: Function }}
 */
export function createContestController({
    browserLogin,
    context,
    executeCommand = async () => {},
    openTextDocument,
    showTextDocument = async () => undefined,
    outputChannel,
    resolvePollIntervalMs = () => DEFAULT_POLL_INTERVAL_MS,
    resolveBaseUrl,
    resolveConfirmBeforeSubmit = () => true,
    sessionApi,
    setContext,
    showInformationMessage,
    showErrorMessage,
    showWarningMessage = async () => undefined,
    showQuickPick = async () => undefined,
    withExplorerProgress = async (task) => await task(),
    withCancellableProgress = async (_title, task) => await task({ onCancellationRequested: () => {} }),
    submissionWorkspace,
    teamsStandingsProvider,
    treeProvider,
    statusBar = null,
    explorerView = null,
    teamsView = null,
    revealSubmission = async () => {},
    toFileUri = (fsPath) => fsPath,
    now = Date.now,
    pageFiles = new ContestPageFiles(resolvePreviewRoot(context)),
}) {
    let currentSnapshot = treeProvider.getSnapshot?.() ?? null;
    let teamsRefreshErrorMessage = null;
    let teamsRefreshInFlight = false;
    // A silent restore started because the contest just began.
    let contestStartReloadInFlight = false;
    // Earliest time (ms) for the next contest-start reload; 0 = no backoff.
    let contestStartRetryAt = 0;
    // The "not started" line was logged for the current not-started period.
    let notStartedLogged = false;
    let standingsTimer = null;
    let explorerTimer = null;
    let sessionEndedPromptShown = false;
    // Bumped whenever the session changes (login, logout, session end). Every
    // async path captures it at its start and drops its result when it moved,
    // so a reply for an old session never touches the new one or its token.
    let sessionGeneration = 0;
    // Number of logins redeeming a hand-off code right now (a counter, so one
    // login settling never clears the flag of another): the generation already
    // moved but the new token is not stored yet, so a restore or standings
    // refresh started now would read the OLD token (and could clear the new
    // one on SESSION_ENDED). Both are skipped while it is above zero.
    let loginRedeemsInFlight = 0;
    // Id of the most recently started login; an older login whose redeem
    // settles after a newer one started drops its result.
    let latestLoginId = 0;
    // Token of the submit currently between its start and the judge POST
    // response; a second submit is refused meanwhile so it never double-posts.
    let sendingSubmit = null;
    // Submission id -> { submission, problem, deadline, userInitiated, settle, promise }:
    // the pending set the single shared poll loop checks every interval.
    const activePolls = new Map();
    // Promise of the running shared poll loop, or null.
    let pollLoop = null;
    // Last poll failure logged; cleared after a successful request so a
    // recurring failure is logged again.
    let pollErrorMessage = null;
    // Submission ids already logged as "still being judged", so a submission
    // stuck in the judge is reported once, not on every 2.5 min retry.
    const stillJudgingLogged = new Set();
    // Re-poll timers for submissions whose poll timed out while still pending.
    const pollRetryTimers = new Set();
    let pollAbort = new AbortController();
    const viewSubscriptions = [];

    const log = (level, message) => logToChannel(outputChannel, level, message);

    /**
     * Label a problem as `A. Title` against the current contest problems,
     * tolerating missing titles.
     * @param {object | null | undefined} problem
     * @returns {string}
     */
    const problemLabel = (problem) => getProblemPageName(problem, currentSnapshot?.problems ?? []);

    /**
     * Push a snapshot (or null) into both trees and the status bar, set the
     * view-state context key, and (re)arm the refresh timers. A null snapshot
     * also stops every running verdict poll.
     * @param {object | null} snapshot
     * @param {string} [emptyState] state for a null snapshot (`loggedOut` or `offline`)
     * @returns {Promise<object | null>}
     */
    const syncTreeState = async (snapshot, emptyState = VIEW_STATES.LOGGED_OUT) => {
        currentSnapshot = snapshot;
        treeProvider.setSnapshot(snapshot);
        teamsStandingsProvider.setSnapshot(snapshot);
        syncStatusBar();
        await setContext(CONTEXT_KEYS.STATE, snapshot ? VIEW_STATES.LOGGED_IN : emptyState);

        if (!snapshot) {
            stopAllPolling();
        }

        syncTimers();
        return snapshot;
    };

    /**
     * Show the current snapshot and its pending-verdict count in the status bar.
     */
    const syncStatusBar = () => {
        if (!statusBar) {
            return;
        }

        statusBar.update(currentSnapshot);
        statusBar.setPendingCount(countPendingSubmissions(currentSnapshot));
    };

    /**
     * Report a failed command in the output channel and an error toast. A
     * session that ended on the server is handled globally, and an invalid
     * setting offers an `Open Settings` action.
     * @param {Error & { statusCode?: number, code?: string, setting?: string }} error
     * @param {number} [generation] session generation the failed work started in
     * @returns {Promise<null>}
     */
    const handleFailure = async (error, generation = sessionGeneration) => {
        if (isSessionEnded(error)) {
            return handleSessionEnded(generation);
        }

        log('error', error.message);
        notifyFailure(error);
        return null;
    };

    /**
     * Show the error toast for a failure without waiting for it to close.
     * @param {Error & { code?: string, setting?: string }} error
     */
    const notifyFailure = (error) => {
        if (error?.code === INVALID_SETTING_CODE && error.setting) {
            void Promise.resolve(showErrorMessage(error.message, OPEN_SETTINGS_ACTION))
                .then(action => (action === OPEN_SETTINGS_ACTION
                    ? executeCommand('workbench.action.openSettings', error.setting)
                    : null));
            return;
        }

        void Promise.resolve(showErrorMessage(error.message));
    };

    /**
     * Forget the dead session token, return the sidebar to the logged-out state,
     * and offer a "Log In" action. Several requests can notice the same ended
     * session at once, so the prompt is only shown once until the next login.
     * An error from an older session (the user logged in again meanwhile) is
     * ignored, so it never deletes the new token.
     * @param {number} [generation] session generation the failed request started in
     * @returns {Promise<null>}
     */
    const handleSessionEnded = async (generation = sessionGeneration) => {
        if (generation !== sessionGeneration) {
            return null;
        }

        startNewSession();
        await sessionApi.clearStoredSession(context);
        await syncTreeState(null);

        if (sessionEndedPromptShown) {
            return null;
        }

        sessionEndedPromptShown = true;
        log('warn', SESSION_ENDED_MESSAGE);

        // Do not wait for the toast: callers may be inside a progress
        // notification or a command that should finish right away.
        void Promise.resolve(showWarningMessage(SESSION_ENDED_MESSAGE, LOG_IN_ACTION))
            .then(action => (action === LOG_IN_ACTION ? controller.loginTeam() : null));

        return null;
    };

    /**
     * Tell the user to log in first, offering the `Log In` action.
     * @returns {null}
     */
    const promptLogIn = () => {
        void Promise.resolve(showErrorMessage(LOGGED_OUT_MESSAGE, LOG_IN_ACTION))
            .then(action => (action === LOG_IN_ACTION ? controller.loginTeam() : null));
        return null;
    };

    /**
     * Check whether a team token is stored, so a failed restore can tell
     * "offline" (token kept) from "logged out".
     * @returns {Promise<boolean>}
     */
    const hasStoredToken = async () => {
        try {
            return Boolean((await sessionApi.readStoredSession(context))?.token);
        }
        catch {
            return false;
        }
    };

    /**
     * Let the user choose a contest problem from a quick pick sorted by order.
     * @param {string} placeHolder
     * @param {string | null} [preferredId] route id of the problem to move first so it is highlighted by default
     * @param {{ unsolvedOnly?: boolean }} [options] `unsolvedOnly` hides solved problems (submit)
     * @returns {Promise<object | null>} null when logged out, empty, all solved, or cancelled
     */
    const pickProblem = async (placeHolder, preferredId = null, { unsolvedOnly = false } = {}) => {
        if (!currentSnapshot) {
            return promptLogIn();
        }

        const problems = sortProblems(currentSnapshot.problems);
        if (!problems.length) {
            const message = currentSnapshot.contestNotStarted
                ? 'The contest has not started yet.'
                : 'This contest has no problems yet.';
            void Promise.resolve(showInformationMessage(message));
            return null;
        }

        const candidates = unsolvedOnly
            ? problems.filter(problem => !summarizeProblemSubmissions(problem, currentSnapshot.submissions).solved)
            : problems;
        if (!candidates.length) {
            void Promise.resolve(showInformationMessage(ALL_SOLVED_MESSAGE));
            return null;
        }

        const items = candidates.map(problem => ({
            label: getProblemPageName(problem, problems),
            description: describeProblemProgress(problem, currentSnapshot.submissions),
            problem,
        }));
        const preferredIndex = preferredId
            ? items.findIndex(item => resolveRouteId(item.problem) === preferredId)
            : -1;

        if (preferredIndex >= 0) {
            const [preferred] = items.splice(preferredIndex, 1);
            // A single-select quick pick highlights its first item, so moving the
            // preferred problem to the front is what preselects it.
            items.unshift(preferred);
        }

        const picked = await showQuickPick(items, { placeHolder, matchOnDescription: true });
        return picked?.problem ?? null;
    };

    /**
     * Resolve the problem a command should act on: an explicit problem, a tree
     * item `{ problem }`, or (palette, editor title Uri, nothing) a quick pick.
     * @param {unknown} arg
     * @param {string} placeHolder
     * @param {string | null} [preferredId]
     * @param {{ unsolvedOnly?: boolean }} [options] forwarded to the quick pick
     * @returns {Promise<object | null>}
     */
    const resolveProblem = async (arg, placeHolder, preferredId = null, options = {}) => {
        if (arg?.problem) {
            return arg.problem;
        }

        if (arg && !isUriLike(arg)) {
            return arg;
        }

        return pickProblem(placeHolder, preferredId, options);
    };

    /**
     * Read the source file to submit. With a Uri (editor title button) that is
     * not the active editor, open it first so the right file is read.
     * @param {unknown} uri
     * @returns {Promise<{ filename: string, sourceCode: string, uri?: object, document?: object, isDirty?: boolean }>}
     */
    const readSubmissionSource = async (uri) => {
        if (isUriLike(uri)) {
            let active = null;
            try {
                active = await submissionWorkspace.readActiveSourceFile();
            }
            catch {
                active = null;
            }

            if (active && active.uri?.fsPath === uri.fsPath) {
                return active;
            }

            const document = await openTextDocument(uri);
            await showTextDocument(document);
        }

        return submissionWorkspace.readActiveSourceFile();
    };

    /**
     * Read the remembered `fsPath -> problem route id` map from workspace state.
     * @returns {Record<string, string>}
     */
    const readLastProblemByFile = () => {
        const value = context?.workspaceState?.get?.(LAST_PROBLEM_BY_FILE_KEY);
        return value && typeof value === 'object' ? value : {};
    };

    /**
     * Remember which problem a file was last submitted to, keeping only the
     * most recent entries.
     * @param {string | undefined} fsPath
     * @param {object} problem
     * @returns {Promise<void>}
     */
    const rememberProblemForFile = async (fsPath, problem) => {
        const problemId = resolveRouteId(problem);
        if (!fsPath || !problemId || typeof context?.workspaceState?.update !== 'function') {
            return;
        }

        const entries = Object.entries(readLastProblemByFile()).filter(([path]) => path !== fsPath);
        entries.push([fsPath, problemId]);
        await context.workspaceState.update(
            LAST_PROBLEM_BY_FILE_KEY,
            Object.fromEntries(entries.slice(-MAX_REMEMBERED_FILES)),
        );
    };

    /**
     * Ask before submitting. A dirty file gets one modal that saves and submits;
     * otherwise the confirmation modal is shown unless the
     * `confirmBeforeSubmit` setting is off.
     * @param {{ filename: string, isDirty?: boolean, document?: { save?: () => Promise<boolean> } }} source
     * @param {object} problem
     * @returns {Promise<boolean>} true to continue
     */
    const confirmSubmission = async (source, problem) => {
        const label = problemLabel(problem);
        const penalty = describePenalty(currentSnapshot?.contest);

        if (source.isDirty) {
            const action = await showWarningMessage(
                `${source.filename} has unsaved changes.`,
                { modal: true, detail: `Save it and submit to ${label}? ${penalty}` },
                SAVE_AND_SUBMIT_ACTION,
            );
            if (action !== SAVE_AND_SUBMIT_ACTION) {
                return false;
            }

            const saved = await source.document?.save?.();
            if (saved === false) {
                throw new Error(`Could not save ${source.filename}.`);
            }

            return true;
        }

        if (resolveConfirmBeforeSubmit() === false) {
            return true;
        }

        // A routine action: an information modal, not an alarming warning.
        const action = await showInformationMessage(
            `Submit ${source.filename} to ${label}?`,
            { modal: true, detail: penalty },
            SUBMIT_ACTION,
        );
        return action === SUBMIT_ACTION;
    };

    /**
     * Refresh contest standings without reloading problems or submissions.
     * Updates only the Standings view and the status bar; the explorer is not
     * re-rendered. When the contest has just started, a full restore follows.
     */
    const refreshTeamsStandings = async () => {
        if (teamsRefreshInFlight || loginRedeemsInFlight > 0) {
            return;
        }

        if (!resolveRouteId(currentSnapshot?.contest)) {
            return;
        }

        teamsRefreshInFlight = true;
        const generation = sessionGeneration;

        try {
            const refreshedContest = await sessionApi.refreshContestDetails({
                baseUrl: resolveBaseUrl(),
                contest: currentSnapshot.contest,
                context,
            });

            if (generation !== sessionGeneration) {
                return;
            }

            teamsRefreshErrorMessage = null;

            if (!refreshedContest) {
                await syncTreeState(null);
                return;
            }

            if (!currentSnapshot) {
                return;
            }

            currentSnapshot = {
                ...currentSnapshot,
                team: { ...currentSnapshot.team },
                contest: refreshedContest,
            };
            teamsStandingsProvider.setSnapshot(currentSnapshot);
            syncStatusBar();
            reloadIfContestStarted();
        }
        catch (error) {
            if (generation !== sessionGeneration) {
                return;
            }

            if (isSessionEnded(error)) {
                await handleSessionEnded(generation);
                return;
            }

            if (teamsRefreshErrorMessage !== error.message) {
                log('warn', `Standings refresh failed: ${error.message}`);
                teamsRefreshErrorMessage = error.message;
            }
        }
        finally {
            teamsRefreshInFlight = false;
        }
    };

    /**
     * Once a contest shown as not started reaches its start time, run a silent
     * full restore so the problems load without a manual refresh. When the
     * server still says "not started" (client clock ahead), the next attempt
     * waits CONTEST_START_RETRY_MS instead of following every standings tick.
     */
    const reloadIfContestStarted = () => {
        if (!currentSnapshot?.contestNotStarted
            || contestStartReloadInFlight
            || now() < contestStartRetryAt
            || getContestTiming(currentSnapshot.contest, now()).phase === 'notStarted') {
            return;
        }

        if (!contestStartRetryAt) {
            log('info', 'The contest has started. Loading the problems…');
        }

        contestStartReloadInFlight = true;
        const generation = sessionGeneration;
        void restoreSession(true).finally(() => {
            contestStartReloadInFlight = false;
            if (generation === sessionGeneration && currentSnapshot?.contestNotStarted) {
                contestStartRetryAt = now() + CONTEST_START_RETRY_MS;
            }
        });
    };

    /**
     * Whether a view is visible; a view that was not passed in counts as visible.
     * @param {{ visible?: boolean } | null} view
     * @returns {boolean}
     */
    const isVisible = (view) => view?.visible ?? true;

    /**
     * (Re)arm the standings refresh (15 s while Standings is visible, 60 s
     * otherwise) and the 60 s explorer re-render. Both stop without a contest.
     */
    const syncTimers = () => {
        clearTimers();

        if (!currentSnapshot) {
            return;
        }

        if (resolveRouteId(currentSnapshot.contest)) {
            const interval = isVisible(teamsView)
                ? TEAM_PANEL_REFRESH_INTERVAL_MS
                : HIDDEN_STANDINGS_REFRESH_INTERVAL_MS;
            standingsTimer = setInterval(() => {
                void refreshTeamsStandings();
            }, interval);
        }

        // Push the latest snapshot so the header also picks up the contest
        // refreshed by the standings timer, not only fresher relative ages.
        explorerTimer = setInterval(() => {
            if (isVisible(explorerView)) {
                treeProvider.setSnapshot(currentSnapshot);
            }
        }, EXPLORER_RERENDER_INTERVAL_MS);
    };

    /**
     * Stop the standings refresh and explorer re-render timers.
     */
    const clearTimers = () => {
        if (standingsTimer) {
            clearInterval(standingsTimer);
            standingsTimer = null;
        }

        if (explorerTimer) {
            clearInterval(explorerTimer);
            explorerTimer = null;
        }
    };

    /**
     * Abort the verdict poll loop (logout, session end, dispose): pending
     * `trackSubmission` promises settle with their submission and scheduled
     * re-polls are cancelled.
     */
    const stopAllPolling = () => {
        pollAbort.abort();
        pollAbort = new AbortController();
        pollLoop = null;
        settleAllPolls();
        for (const timer of pollRetryTimers) {
            clearTimeout(timer);
        }
        pollRetryTimers.clear();
    };

    /**
     * Settle and forget every tracked submission with its last known state.
     */
    const settleAllPolls = () => {
        for (const entry of activePolls.values()) {
            entry.settle(entry.submission);
        }
        activePolls.clear();
    };

    /**
     * Start a new session generation (login, logout, session end): results of
     * older async work are dropped from now on and every verdict poll stops.
     */
    const startNewSession = () => {
        sessionGeneration += 1;
        stillJudgingLogged.clear();
        notStartedLogged = false;
        contestStartRetryAt = 0;
        stopAllPolling();
    };

    /**
     * Merge a submission into the in-memory snapshot so both sidebar views and
     * the status bar update immediately. The judge response is only
     * `{ id, status }`, so a missing problem and `submittedAt` (now) are
     * stamped on, keeping the new submission first in newest-first lists.
     * @param {object} problem
     * @param {object} submission
     * @returns {Promise<object | null>}
     */
    const mergeSubmissionIntoSnapshot = async (problem, submission) => {
        if (!currentSnapshot) {
            return null;
        }

        const normalizedSubmission = {
            ...submission,
            problem: submission.problem ?? {
                publicId: problem?.publicId,
                title: problem?.title,
            },
            submittedAt: submission.submittedAt ?? new Date(now()).toISOString(),
        };

        const nextSnapshot = {
            ...currentSnapshot,
            submissions: [
                normalizedSubmission,
                ...(currentSnapshot.submissions ?? []).filter(entry => entry.id !== normalizedSubmission.id),
            ],
        };

        await syncTreeState(nextSnapshot);
        return nextSnapshot;
    };

    /**
     * Ask the explorer to reveal a just-submitted row (a collapsed problem
     * would otherwise hide it). Fire-and-forget: it never blocks the submit
     * flow or shows a toast. The injected `revealSubmission` owns error
     * handling and logging (see `createSubmissionReveal`); the empty catch only
     * keeps a misbehaving callback from becoming an unhandled rejection.
     * @param {string | number} submissionId
     */
    const revealNewSubmission = (submissionId) => {
        void Promise.resolve()
            .then(() => revealSubmission(submissionId))
            .catch(() => {});
    };

    /**
     * Show the verdict toast: information for Accepted, warning otherwise, with
     * `View Details` and (when the judge returned output) `Compare Output`.
     * Not awaited, so polling and commands finish right away.
     * @param {object} submission final submission
     */
    const notifyVerdict = (submission) => {
        const label = problemLabel(submission.problem);
        const accepted = isPassedSubmission(submission.status);
        const message = accepted
            ? `Accepted: ${label} (#${submission.id})`
            : `${formatSubmissionStatus(submission.status)} on ${label} (#${submission.id})`;
        const actions = [VIEW_DETAILS_ACTION];
        if (hasComparableOutput(submission)) {
            actions.push(COMPARE_OUTPUT_ACTION);
        }

        log(accepted ? 'info' : 'warn', message);

        const show = accepted ? showInformationMessage : showWarningMessage;
        void Promise.resolve(show(message, ...actions)).then((action) => {
            if (action === VIEW_DETAILS_ACTION) {
                return controller.openSubmission(submission);
            }
            if (action === COMPARE_OUTPUT_ACTION) {
                return controller.compareSubmissionOutput(submission);
            }
            return null;
        });
    };

    /**
     * Track one pending submission until it gets a verdict. Every tracked id
     * is checked by the single shared poll loop; tracking an id twice returns
     * the same promise.
     * @param {object} submission
     * @param {{ problem?: object, userInitiated?: boolean }} [options]
     * @returns {Promise<object>} the final submission, or the given one on timeout, failure or stop
     */
    const trackSubmission = (submission, { problem = submission?.problem, userInitiated = false } = {}) => {
        if (!isPendingSubmission(submission?.status) || submission?.id == null) {
            return Promise.resolve(submission);
        }

        const key = String(submission.id);
        if (activePolls.has(key)) {
            return activePolls.get(key).promise;
        }

        let settle;
        const promise = new Promise((resolve) => {
            settle = resolve;
        });
        activePolls.set(key, {
            submission,
            problem,
            userInitiated,
            deadline: now() + SUBMISSION_POLL_TIMEOUT_MS,
            settle,
            promise,
        });
        ensurePollLoop();
        return promise;
    };

    /**
     * Drop tracked ids past their deadline and schedule a slower re-poll for
     * each while the session is unchanged and it is still pending. The
     * "still being judged" warning is logged once per submission id.
     * @param {number} generation
     * @returns {string[]} the ids still tracked
     */
    const expireTimedOutPolls = (generation) => {
        const currentTime = now();
        for (const [key, entry] of activePolls) {
            if (currentTime < entry.deadline) {
                continue;
            }

            activePolls.delete(key);
            entry.settle(entry.submission);
            if (!stillJudgingLogged.has(key)) {
                stillJudgingLogged.add(key);
                log('warn', `Submission #${key} is still being judged. Checking again in ${SUBMISSION_POLL_BACKOFF_MS / 1000} s.`);
            }

            const timer = setTimeout(() => {
                pollRetryTimers.delete(timer);
                const latest = (currentSnapshot?.submissions ?? []).find(item => String(item?.id) === key);
                if (generation === sessionGeneration && isPendingSubmission(latest?.status)) {
                    void trackSubmission(latest, { problem: entry.problem });
                }
            }, SUBMISSION_POLL_BACKOFF_MS);
            pollRetryTimers.add(timer);
        }

        return [...activePolls.keys()];
    };

    /**
     * Apply a final verdict from the poll loop: merge it, show the toast, and
     * settle its `trackSubmission` promise.
     * @param {object} finalSubmission
     * @param {number} generation
     * @returns {Promise<void>}
     */
    const applyPolledVerdict = async (finalSubmission, generation) => {
        const key = String(finalSubmission.id);
        const entry = activePolls.get(key);
        if (!entry || generation !== sessionGeneration) {
            return;
        }

        activePolls.delete(key);
        stillJudgingLogged.delete(key);
        const { problem } = entry;
        await mergeSubmissionIntoSnapshot(problem, finalSubmission);
        notifyVerdict(finalSubmission.problem ? finalSubmission : { ...finalSubmission, problem });
        entry.settle(finalSubmission);
    };

    /**
     * Start the shared poll loop unless it already runs. Failed requests are
     * retried by the loop; an ended session is handled globally; any other
     * failure (no token, invalid setting) stops tracking with a log line and,
     * for a submission the user just sent, an error toast.
     */
    const ensurePollLoop = () => {
        if (pollLoop || !activePolls.size) {
            return;
        }

        const generation = sessionGeneration;
        const { signal } = pollAbort;
        const isCurrent = () => !signal.aborted && generation === sessionGeneration;
        // Ids the loop read last; only ids tracked after that need a new loop.
        let seenIds = new Set();
        const loop = (async () => {
            try {
                await sessionApi.pollSubmissionResults({
                    baseUrl: resolveBaseUrl(),
                    context,
                    pollIntervalMs: resolvePollIntervalMs(),
                    signal,
                    tracker: {
                        ids: () => {
                            const ids = expireTimedOutPolls(generation);
                            seenIds = new Set(ids);
                            return ids;
                        },
                        resolve: (finalSubmission) => applyPolledVerdict(finalSubmission, generation),
                        onSuccess: () => {
                            pollErrorMessage = null;
                        },
                        onError: (error) => {
                            if (pollErrorMessage !== error.message) {
                                pollErrorMessage = error.message;
                                log('warn', `Checking submissions failed, retrying: ${error.message}`);
                            }
                        },
                    },
                });
                pollErrorMessage = null;
            }
            catch (error) {
                if (!isCurrent()) {
                    return;
                }

                if (isSessionEnded(error)) {
                    await handleSessionEnded(generation);
                    return;
                }

                const ids = [...activePolls.keys()];
                log('warn', `Stopped checking submissions ${ids.map(id => `#${id}`).join(', ')}: ${error.message}`);
                for (const entry of activePolls.values()) {
                    if (entry.userInitiated) {
                        void Promise.resolve(showErrorMessage(`Could not check submission #${entry.submission.id}: ${error.message}`));
                    }
                }
                settleAllPolls();
            }
        })();

        pollLoop = loop;
        void loop.finally(() => {
            if (pollLoop !== loop) {
                return;
            }

            pollLoop = null;
            // Ids tracked after the loop's last read get a fresh loop.
            if (isCurrent() && [...activePolls.keys()].some(id => !seenIds.has(id))) {
                ensurePollLoop();
            }
        });
    };

    /**
     * Start polling every pending submission of the current snapshot that is
     * not polled yet (after login, refresh, or restore).
     */
    const pollPendingSubmissions = () => {
        for (const submission of currentSnapshot?.submissions ?? []) {
            if (isPendingSubmission(submission?.status)) {
                void trackSubmission(submission);
            }
        }
    };

    /**
     * Load the stored session and show it. Failures other than an ended
     * session keep the token: with a snapshot already shown it stays (with its
     * verdict polls), otherwise the view switches to the offline state.
     * Skipped while a login redeem is in flight; the login loads the snapshot.
     * @param {boolean} silent no error toast (startup restore)
     * @returns {Promise<object | null>}
     */
    const restoreSession = async (silent) => {
        if (loginRedeemsInFlight > 0) {
            return null;
        }

        const generation = sessionGeneration;

        try {
            const snapshot = await sessionApi.restoreContestSession({
                baseUrl: resolveBaseUrl(),
                context,
            });
            // Logged in or out meanwhile: this snapshot belongs to an old session.
            if (generation !== sessionGeneration) {
                return null;
            }

            if (!snapshot) {
                return await syncTreeState(null, VIEW_STATES.LOGGED_OUT);
            }

            sessionEndedPromptShown = false;
            const loadedMessage = `Loaded ${toText(snapshot.contest?.name) || 'the contest'} for ${toText(snapshot.team?.name) || 'your team'}.`;
            if (!snapshot.contestNotStarted) {
                log('info', loadedMessage);
                notStartedLogged = false;
                contestStartRetryAt = 0;
            }
            else if (!notStartedLogged) {
                // The session is kept; the tree shows the contest as not started
                // until a reload finds problems. Both lines are logged once per
                // not-started period, so the 60 s retries stay silent.
                notStartedLogged = true;
                log('info', loadedMessage);
                log('info', CONTEST_NOT_STARTED_MESSAGE);
            }

            await syncTreeState(snapshot);
            pollPendingSubmissions();
            return snapshot;
        }
        catch (error) {
            if (generation !== sessionGeneration) {
                return null;
            }

            if (isSessionEnded(error)) {
                return handleSessionEnded(generation);
            }

            if (!currentSnapshot) {
                const tokenStored = await hasStoredToken();
                if (generation !== sessionGeneration) {
                    return null;
                }

                await syncTreeState(null, tokenStored ? VIEW_STATES.OFFLINE : VIEW_STATES.LOGGED_OUT);
            }

            log('error', `Could not load the contest: ${error.message}`);
            if (!silent) {
                notifyFailure(error);
            }
            return null;
        }
    };

    /**
     * Subscribe to view visibility: showing Standings refreshes it at once and
     * switches to the 15 s cadence; showing the explorer re-renders its ages.
     */
    const watchViewVisibility = () => {
        if (typeof teamsView?.onDidChangeVisibility === 'function') {
            viewSubscriptions.push(teamsView.onDidChangeVisibility((event) => {
                syncTimers();
                if (event?.visible ?? teamsView.visible) {
                    void refreshTeamsStandings();
                }
            }));
        }

        if (typeof explorerView?.onDidChangeVisibility === 'function') {
            viewSubscriptions.push(explorerView.onDidChangeVisibility((event) => {
                if ((event?.visible ?? explorerView.visible) && currentSnapshot) {
                    treeProvider.setSnapshot(currentSnapshot);
                }
            }));
        }
    };

    /**
     * Write a generated Markdown page through the page-file writer and open
     * it in the Markdown preview. The file name is the page name, so the tab
     * reads `Preview <page name>.md`.
     * @param {string} folder per-kind subfolder
     * @param {string} pageName
     * @param {string} fallbackName file name when the page name is unusable
     * @param {string} content
     * @returns {Promise<object>} the opened document
     */
    const openGeneratedPage = async (folder, pageName, fallbackName, content) => {
        const filePath = await pageFiles.writePage(folder, pageName, fallbackName, content);
        const document = await openTextDocument(filePath);
        // Use the built-in Markdown viewer so the page renders from the
        // persisted file instead of an untitled scratch buffer.
        await executeCommand('markdown.showPreview', document.uri, { preview: true });
        return document;
    };

    const controller = {
        /**
         * Dispose controller-owned timers, polls, and view subscriptions.
         */
        dispose() {
            clearTimers();
            startNewSession();
            for (const subscription of viewSubscriptions.splice(0)) {
                subscription?.dispose?.();
            }
        },

        /**
         * Log in through the browser: open the web team login, wait for it to
         * hand a one-time code back to VS Code, redeem it for the team session
         * token, then load and display the contest snapshot. No credentials are
         * typed or handled here.
         * @returns {Promise<object | null>}
         */
        async loginTeam() {
            // A new login starts a new session, so a later session end may prompt again.
            sessionEndedPromptShown = false;
            let redeeming = false;
            // Id of this login once its code is redeemed; null before that.
            let loginId = null;

            try {
                // Check the API setting before the browser round-trip so an
                // invalid value fails fast with the Open Settings action.
                const baseUrl = resolveBaseUrl();
                const code = await withCancellableProgress(
                    WAITING_FOR_BROWSER_MESSAGE,
                    (cancellation) => browserLogin.waitForHandoffCode(cancellation),
                );
                // Redeeming replaces the stored token: from here on, results of
                // the old session (restore, refresh, polls) are dropped.
                loginRedeemsInFlight += 1;
                loginId = ++latestLoginId;
                startNewSession();
                redeeming = true;
                let snapshot;
                try {
                    snapshot = await sessionApi.redeemAndLoadContest({
                        baseUrl,
                        code,
                        context,
                        isCurrent: () => loginId === latestLoginId,
                    });
                }
                finally {
                    loginRedeemsInFlight -= 1;
                }
                redeeming = false;
                // A newer login started while this one redeemed: its session
                // owns the views now, so this snapshot must not replace it.
                if (loginId !== latestLoginId) {
                    return null;
                }

                sessionEndedPromptShown = false;
                log('info', `Logged in as ${toText(snapshot.team?.name) || 'your team'} for ${toText(snapshot.contest?.name) || 'the contest'}.`);
                await syncTreeState(snapshot);
                pollPendingSubmissions();
                return snapshot;
            }
            catch (error) {
                // A newer login superseded this one: its session owns the views
                // and token now, so this failure must not clear that token or
                // toast. Only the resume-polls guard below may still apply.
                const superseded = loginId !== null && loginId !== latestLoginId;
                // A failed redeem keeps the shown snapshot; resume its verdict
                // polls unless another login is still redeeming (it decides).
                if (redeeming && loginRedeemsInFlight === 0 && currentSnapshot && !isSessionEnded(error)) {
                    pollPendingSubmissions();
                }

                if (superseded) {
                    log('info', 'Login superseded by a newer login.');
                    return null;
                }

                if (error instanceof BrowserLoginError && (error.reason === LOGIN_FAILURE.CANCELLED || error.reason === LOGIN_FAILURE.SUPERSEDED)) {
                    log('info', 'Login cancelled.');
                    return null;
                }

                if (error?.code === HANDOFF_INVALID_CODE) {
                    return handleFailure(new Error(HANDOFF_INVALID_MESSAGE));
                }

                return handleFailure(error);
            }
        },

        /**
         * Forget the stored team token and return the sidebar to the logged-out
         * state. This is local only: the team session stays active on the server,
         * so the browser (and a later login from here) keep working.
         * @returns {Promise<null>}
         */
        async logoutTeam() {
            startNewSession();
            await sessionApi.clearStoredSession(context);
            log('info', 'Logged out of AutoJudge Contest.');
            await syncTreeState(null);
            return null;
        },

        /**
         * Open the contest overview page. The current snapshot's contest (kept
         * fresh by the standings refresh) wins over the tree item's copy, which
         * may be stale; the argument is only a fallback without a snapshot.
         * @param {object | undefined | null} contest contest or tree item `{ contest }`
         * @returns {Promise<object | null>}
         */
        async openContestDashboard(contest) {
            const selectedContest = currentSnapshot?.contest ?? contest?.contest ?? contest;
            if (!selectedContest) {
                return promptLogIn();
            }

            try {
                await openGeneratedPage(
                    'contest-dashboards',
                    getContestPageName(selectedContest),
                    `contest-${resolveRouteId(selectedContest) ?? 'unknown'}`,
                    renderContestDashboard(selectedContest, {
                        team: currentSnapshot?.team,
                        problems: currentSnapshot?.problems,
                    }, now()),
                );
                return selectedContest;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open the problem statement page. Without a problem a quick pick asks
         * which one.
         * @param {unknown} arg problem, tree item `{ problem }`, or nothing
         * @returns {Promise<unknown | null>} the opened document
         */
        async openProblem(arg) {
            const problem = await resolveProblem(arg, 'Open which problem?');
            if (!problem) {
                return null;
            }

            try {
                const problems = currentSnapshot?.problems ?? [];
                return await openGeneratedPage(
                    'problem-previews',
                    getProblemPageName(problem, problems),
                    `problem-${resolveRouteId(problem) ?? 'unknown'}`,
                    renderProblemPage(problem, {
                        problems,
                        submissions: currentSnapshot?.submissions ?? [],
                    }),
                );
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open the submission details page.
         * @param {object | undefined | null} submission submission or tree item `{ submission }`
         * @returns {Promise<object | null>}
         */
        async openSubmission(submission) {
            const selectedSubmission = submission?.submission ?? submission;
            if (!selectedSubmission) {
                void Promise.resolve(showErrorMessage('Choose a submission in Contest Explorer first.'));
                return null;
            }

            try {
                const problems = currentSnapshot?.problems ?? [];
                await openGeneratedPage(
                    'submission-details',
                    getSubmissionPageName(selectedSubmission, problems),
                    `submission-${selectedSubmission.id ?? 'unknown'}`,
                    renderSubmissionDetails(selectedSubmission, { problems }),
                );
                return selectedSubmission;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open a team's standing page.
         * @param {object | undefined | null} team team or tree item `{ team }`
         * @returns {Promise<object | null>}
         */
        async openTeamStanding(team) {
            const selectedTeam = team?.team ?? team;
            if (!selectedTeam) {
                void Promise.resolve(showErrorMessage('Choose a team in Standings first.'));
                return null;
            }

            try {
                await openGeneratedPage(
                    'team-details',
                    getTeamPageName(selectedTeam),
                    `team-${resolveRouteId(selectedTeam) ?? 'unknown'}`,
                    renderTeamStandingDetails(selectedTeam, currentSnapshot),
                );
                return selectedTeam;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Diff a submission's expected and received output: both are written to
         * `submission-output/<id>/` by the page-file writer and opened
         * with `vscode.diff`.
         * @param {object | undefined | null} submission submission or tree item `{ submission }`
         * @returns {Promise<{ expectedPath: string, receivedPath: string } | null>}
         */
        async compareSubmissionOutput(submission) {
            const selectedSubmission = submission?.submission ?? submission;
            if (!selectedSubmission) {
                void Promise.resolve(showErrorMessage('Choose a submission in Contest Explorer first.'));
                return null;
            }

            if (!hasComparableOutput(selectedSubmission)) {
                void Promise.resolve(showInformationMessage(`Submission #${selectedSubmission.id} has no expected and received output to compare.`));
                return null;
            }

            try {
                const { hint } = selectedSubmission;
                const { expectedPath, receivedPath } = await pageFiles.writeComparison(
                    selectedSubmission.id,
                    hint.expected,
                    hint.received,
                );
                await executeCommand(
                    'vscode.diff',
                    toFileUri(expectedPath),
                    toFileUri(receivedPath),
                    `Submission #${selectedSubmission.id}: expected ↔ received`,
                );
                return { expectedPath, receivedPath };
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Submit a source file. The problem comes from the tree item or a quick
         * pick (preselecting the problem this file was last submitted to); the
         * file is the active editor, or the editor-title Uri. Unsaved changes
         * are saved after a prompt and, unless the setting is off, the submit is
         * confirmed. The pending submission shows in the tree and status bar;
         * the verdict arrives as a toast. Only one submit runs at a time up
         * to the judge response; a second one meanwhile is refused.
         * @param {unknown} arg problem, tree item `{ problem }`, editor Uri, or nothing
         * @returns {Promise<object | null>} the final (or still pending) submission
         */
        async submitActiveFile(arg) {
            if (!currentSnapshot) {
                return promptLogIn();
            }

            if (sendingSubmit) {
                void Promise.resolve(showInformationMessage(SUBMIT_IN_PROGRESS_MESSAGE));
                return null;
            }

            const generation = sessionGeneration;
            const submitToken = {};
            sendingSubmit = submitToken;
            const releaseSubmit = () => {
                if (sendingSubmit === submitToken) {
                    sendingSubmit = null;
                }
            };

            try {
                const source = await readSubmissionSource(isUriLike(arg) ? arg : null);
                const preferredId = readLastProblemByFile()[source.uri?.fsPath] ?? null;
                const problem = await resolveProblem(
                    isUriLike(arg) ? null : arg,
                    `Submit ${source.filename} to which problem?`,
                    preferredId,
                    { unsolvedOnly: true },
                );
                if (!problem) {
                    return null;
                }

                // The server refuses another submission once a problem is solved.
                if (summarizeProblemSubmissions(problem, currentSnapshot?.submissions).solved) {
                    void Promise.resolve(showInformationMessage(`${problemLabel(problem)} is already solved.`));
                    return null;
                }

                if (!(await confirmSubmission(source, problem))) {
                    return null;
                }

                // Re-read the saved document (format-on-save may have changed
                // it), not the active editor: the user may have switched files.
                const { sourceCode } = source.isDirty
                    ? submissionWorkspace.readSourceDocument(source.document)
                    : source;
                const submission = await sessionApi.submitSolution({
                    baseUrl: resolveBaseUrl(),
                    code: encodeSourceCode(sourceCode),
                    context,
                    filename: source.filename,
                    problemId: resolveRouteId(problem),
                });
                // The judge accepted it; polling the verdict must not block another submit.
                releaseSubmit();

                await rememberProblemForFile(source.uri?.fsPath, problem);
                if (generation !== sessionGeneration) {
                    // Logged out or in again meanwhile: leave the new session's view alone.
                    return submission;
                }

                await mergeSubmissionIntoSnapshot(problem, submission);
                revealNewSubmission(submission.id);
                log('info', `Submitted ${source.filename} to ${problemLabel(problem)} (#${submission.id}).`);

                if (!isPendingSubmission(submission?.status)) {
                    notifyVerdict(submission.problem ? submission : { ...submission, problem });
                    return submission;
                }

                return await trackSubmission(submission, { problem, userInitiated: true });
            }
            catch (error) {
                if (error?.code !== REQUEST_TIMEOUT_CODE) {
                    return handleFailure(error, generation);
                }

                // A timed-out upload may still have been accepted: say so instead
                // of inviting a duplicate submit, and reload the submissions.
                await handleFailure(new Error(UPLOAD_TIMEOUT_MESSAGE), generation);
                if (generation === sessionGeneration) {
                    void restoreSession(true);
                }
                return null;
            }
            finally {
                releaseSubmit();
            }
        },

        /**
         * Export a problem's public test cases into a folder (active file's
         * folder, the only workspace folder, or a chosen one), asking before
         * replacing existing files.
         * @param {unknown} arg problem, tree item `{ problem }`, or nothing
         * @returns {Promise<object | null>}
         */
        async exportPublicCases(arg) {
            const problem = await resolveProblem(arg, 'Export test cases for which problem?');
            if (!problem) {
                return null;
            }

            const label = problemLabel(problem);

            try {
                const publicCases = extractPublicCases(problem);
                if (!publicCases.length) {
                    void Promise.resolve(showInformationMessage(`${label} has no public test cases.`));
                    return null;
                }

                const directoryUri = await submissionWorkspace.pickExportDirectory();
                if (!directoryUri) {
                    return null;
                }

                const existing = await submissionWorkspace.findExistingCaseFiles(problem, publicCases.length, directoryUri);
                if (existing?.length) {
                    const folderName = basename(directoryUri.fsPath ?? '') || 'this folder';
                    const action = await showWarningMessage(
                        `Replace ${pluralize(existing.length, 'existing test case file')} in ${folderName}?`,
                        { modal: true },
                        REPLACE_ACTION,
                    );
                    if (action !== REPLACE_ACTION) {
                        return null;
                    }
                }

                const exportResult = await submissionWorkspace.exportPublicCases(problem, publicCases, { directoryUri });
                const message = `Exported ${pluralize(publicCases.length, 'public test case')} for ${label}.`;
                log('info', message);

                const firstInputUri = exportResult?.writtenPairs?.[0]?.inputUri;
                void Promise.resolve(showInformationMessage(message, REVEAL_ACTION, OPEN_FIRST_CASE_ACTION))
                    .then(async (action) => {
                        if (!firstInputUri) {
                            return null;
                        }
                        if (action === REVEAL_ACTION) {
                            return executeCommand('revealInExplorer', firstInputUri);
                        }
                        if (action === OPEN_FIRST_CASE_ACTION) {
                            return showTextDocument(await openTextDocument(firstInputUri));
                        }
                        return null;
                    });
                return exportResult;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Reload the stored contest session. A manual refresh shows progress on
         * the explorer and an error toast on failure; the startup restore
         * (`silent`) only writes to the output channel.
         * @param {{ silent?: boolean }} [options]
         * @returns {Promise<object | null>}
         */
        async refreshTree({ silent = false } = {}) {
            if (silent) {
                return restoreSession(true);
            }

            return withExplorerProgress(() => restoreSession(false));
        },
    };

    watchViewVisibility();
    return controller;
}

/**
 * Check whether a command argument is a `vscode.Uri` (editor title buttons
 * pass the editor's Uri) rather than a problem or tree item.
 * @param {unknown} value
 * @returns {boolean}
 */
function isUriLike(value) {
    return Boolean(value)
        && typeof value === 'object'
        && typeof value.scheme === 'string'
        && typeof value.fsPath === 'string';
}

/**
 * Count the snapshot's submissions still waiting for a verdict.
 * @param {object | null} snapshot
 * @returns {number}
 */
function countPendingSubmissions(snapshot) {
    return (snapshot?.submissions ?? []).filter(submission => isPendingSubmission(submission?.status)).length;
}

/**
 * Describe the team's progress on a problem for the quick pick.
 * @param {object} problem
 * @param {object[] | undefined} submissions
 * @returns {string} `✓ Solved`, `N attempts`, or ''
 */
function describeProblemProgress(problem, submissions) {
    const summary = summarizeProblemSubmissions(problem, submissions);
    if (summary.solved) {
        return '✓ Solved';
    }

    return summary.attempts ? pluralize(summary.attempts, 'attempt') : '';
}

/**
 * Explain the penalty of a rejected submission, with the contest's penalty
 * minutes when known. Penalty only counts once the problem is solved.
 * @param {{ penaltyTime?: number } | null | undefined} contest
 * @returns {string}
 */
function describePenalty(contest) {
    const minutes = Number(contest?.penaltyTime);
    return contest?.penaltyTime != null && Number.isFinite(minutes) && minutes > 0
        ? `If it is rejected and you solve the problem later, it adds ${minutes} min of penalty.`
        : 'A rejected attempt adds penalty time if you solve the problem later.';
}

/**
 * Format `count noun(s)`.
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function pluralize(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Trim a possibly missing value to text.
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Encode the source code to base64 to prepare it for submission.
 * @param {string} sourceCode The raw source code string to encode
 * @returns {string} Encoded source code string
 */
function encodeSourceCode(sourceCode) {
    return Buffer.from(sourceCode, 'utf-8').toString('base64');
}
