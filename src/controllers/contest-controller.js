import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTEXT_KEYS } from '../constants.js';
import {
    buildProblemPreview,
    formatProblemScore,
    formatSubmissionStatus,
    renderContestDashboard,
    renderSubmissionDetails,
    renderTeamStandingDetails,
} from '../presentation/contest-presentation.js';
import { HANDOFF_INVALID_CODE, isSessionEnded } from '../services/contest-api.js';
import { BrowserLoginError, LOGIN_FAILURE } from '../services/browser-login.js';
import { isPendingSubmission } from '../utils/submission-status.js';
import { resolveRouteId } from '../utils/public-id.js';
import { extractSolvedProblemNames, normalizeStandingScore } from '../utils/standings.js';
import { extractPublicCases } from '../workspace/contest-public-cases.js';
import { TEAM_PANEL_REFRESH_INTERVAL_MS } from '../utils/config.js';

const SUBMISSION_POLL_TIMEOUT_MS = 2 * 60 * 1000;

const LOGIN_ACTION_LABEL = 'Log in';
const WAITING_FOR_BROWSER_MESSAGE = 'Waiting for you to log in in the browser…';
const SESSION_ENDED_MESSAGE = 'Your session ended. Log in again (ask staff to reset your PIN if needed).';
const HANDOFF_INVALID_MESSAGE = 'The browser login link expired or was already used. Run Login Team again.';
const CONTEST_NOT_STARTED_MESSAGE = 'The contest has not started yet. Refresh once it starts to load the problems.';

/**
 * Create the orchestrator that bridges VS Code command handlers to the contest
 * auth/session services and the sidebar tree state.
 * @param {object} options
 * @param {object} options.context
 * @param {(command: string, ...args: unknown[]) => Promise<void> | void} [options.executeCommand]
 * @param {(uriOrOptions: string | { content: string, language: string }) => Promise<unknown>} options.openTextDocument
 * @param {{ appendLine: (message: string) => void }} options.outputChannel
 * @param {{ waitForHandoffCode: (cancellation?: object) => Promise<string> }} options.browserLogin starts the browser login and resolves with its one-time hand-off code
 * @param {() => number} [options.resolvePollIntervalMs]
 * @param {() => string} options.resolveBaseUrl
 * @param {{ clearStoredSession: Function, redeemAndLoadContest: Function, pollSubmissionResult?: Function, refreshContestDetails?: Function, restoreContestSession: Function, submitSolution: Function }} options.sessionApi
 * @param {(key: string, value: string | boolean) => Promise<void> | void} options.setContext
 * @param {(message: string) => Promise<void> | void} options.showInformationMessage
 * @param {(message: string) => Promise<void> | void} options.showErrorMessage
 * @param {(message: string, ...actions: string[]) => Promise<string | undefined> | string | undefined} options.showWarningMessage resolves with the chosen action label
 * @param {<T>(title: string, task: () => Promise<T>) => Promise<T>} [options.withProgressNotification]
 * @param {<T>(title: string, task: (cancellation: object) => Promise<T>) => Promise<T>} options.withCancellableProgress shows a cancellable notification and passes the cancellation token to the task
 * @param {{ exportPublicCases: Function, readActiveSourceFile: Function }} options.submissionWorkspace
 * @param {{ setSnapshot: (snapshot: object | null) => void }} options.teamsStandingsProvider
 * @param {{ setSnapshot: (snapshot: object | null) => void }} options.treeProvider
 * @returns {{ dispose: () => void, exportPublicCases: (problem?: object | undefined | null) => Promise<object | null>, loginTeam: () => Promise<object | null>, logoutTeam: () => Promise<null>, openProblem: (problem: object | undefined | null) => Promise<unknown>, openSubmission: (submission: object | undefined | null) => Promise<object | null>, openTeamStanding: (team: object | undefined | null) => Promise<object | null>, refreshTree: () => Promise<object | null>, openContestDashboard: () => Promise<object | null>, submitActiveFile: (problem?: object | undefined | null) => Promise<object | null> }}*/
export function createContestController({
    browserLogin,
    context,
    executeCommand = async () => {},
    openTextDocument,
    outputChannel,
    resolvePollIntervalMs,
    resolveBaseUrl,
    sessionApi,
    setContext,
    showInformationMessage,
    showErrorMessage,
    showWarningMessage = async () => undefined,
    withProgressNotification = async (_title, task) => await task(),
    withCancellableProgress = async (_title, task) => await task({ onCancellationRequested: () => {} }),
    submissionWorkspace,
    teamsStandingsProvider,
    treeProvider,
}) {
    let currentSnapshot = treeProvider.getSnapshot?.() ?? null;
    let teamsRefreshErrorMessage = null;
    let teamsRefreshInFlight = false;
    let teamsRefreshTimer = null;
    let sessionEndedPromptShown = false;

    const syncTreeState = async (snapshot) => {
        currentSnapshot = snapshot;
        treeProvider.setSnapshot(snapshot);
        teamsStandingsProvider.setSnapshot(snapshot);
        await setContext(CONTEXT_KEYS.STATE, snapshot ? 'loggedIn' : 'loggedOut');
        syncTeamsRefreshTimer(snapshot);
        return snapshot;
    };

    /**
     * Report a failed command. A session that ended on the server is handled
     * globally: whichever request noticed it, the token is dropped and the user
     * is offered a new login.
     * @param {Error & { statusCode?: number, code?: string }} error
     * @returns {Promise<null>}
     */
    const handleFailure = async (error) => {
        if (isSessionEnded(error)) {
            return handleSessionEnded();
        }

        outputChannel.appendLine(`ERROR: ${error.message}`);
        await showErrorMessage(error.message);
        return null;
    };

    /**
     * Forget the dead session token, return the sidebar to the logged-out state,
     * and offer a "Log in" action. Several requests can notice the same ended
     * session at once, so the prompt is only shown once until the next login.
     * @returns {Promise<null>}
     */
    const handleSessionEnded = async () => {
        await sessionApi.clearStoredSession(context);
        await syncTreeState(null);

        if (sessionEndedPromptShown) {
            return null;
        }

        sessionEndedPromptShown = true;
        outputChannel.appendLine(SESSION_ENDED_MESSAGE);

        // Do not wait for the toast: callers may be inside a progress
        // notification or a command that should finish right away.
        void Promise.resolve(showWarningMessage(SESSION_ENDED_MESSAGE, LOGIN_ACTION_LABEL))
            .then(action => (action === LOGIN_ACTION_LABEL ? controller.loginTeam() : null));

        return null;
    };

    /**
     * Trigger an informational toast without letting its lifecycle delay the
     * command flow when polling progress must continue immediately.
     * @param {string} message
     */
    const notifyInformationMessage = (message) => {
        void Promise.resolve(showInformationMessage(message));
    };

    /**
     * Resolve a required explorer payload and fail clearly when the tree command
     * is invoked against stale or missing state.
     * @param {object | undefined | null} value
     * @param {string} noun
     * @returns {object | null}
     */
    const requireSelection = async (value, noun) => {
        if (value) {
            return value;
        }

        await showErrorMessage(`Select a ${noun} from the contest explorer first.`);
        return null;
    };

    /**
     * Resolve the current submission target from the explicit explorer item.
     * @param {object | undefined | null} problem
     * @returns {Promise<object | null>}
     */
    const resolveSubmissionProblem = async (problem) => {
        if (problem) {
            return problem;
        }

        await showErrorMessage('Choose a contest problem from Contest Explorer first.');
        return null;
    };

    /**
     * Refresh contest standings on a fixed timer without reloading unrelated
     * snapshot slices such as problems or submission history.
     */
    const refreshTeamsStandings = async () => {
        if (teamsRefreshInFlight || typeof sessionApi.refreshContestDetails !== 'function') {
            return;
        }

        if (!resolveRouteId(currentSnapshot?.contest)) {
            return;
        }

        teamsRefreshInFlight = true;

        try {
            const refreshedContest = await sessionApi.refreshContestDetails({
                baseUrl: resolveBaseUrl(),
                contest: currentSnapshot.contest,
                context,
            });

            teamsRefreshErrorMessage = null;

            if (!refreshedContest) {
                await syncTreeState(null);
                return;
            }

            if (!currentSnapshot) {
                return;
            }

            await syncTreeState({
                ...currentSnapshot,
                team: {
                    ...currentSnapshot.team,
                },
                contest: refreshedContest,
            });
        }
        catch (error) {
            if (isSessionEnded(error)) {
                await handleSessionEnded();
                return;
            }

            if (teamsRefreshErrorMessage !== error.message) {
                outputChannel.appendLine(`Standings refresh failed: ${error.message}`);
                teamsRefreshErrorMessage = error.message;
            }
        }
        finally {
            teamsRefreshInFlight = false;
        }
    };

    /**
     * Start or stop the timed standings refresh based on the current snapshot.
     * @param {object | null} snapshot
     */
    const syncTeamsRefreshTimer = (snapshot) => {
        clearTeamsRefreshTimer();

        if (!resolveRouteId(snapshot?.contest) || typeof sessionApi.refreshContestDetails !== 'function') {
            return;
        }

        // Keep the standings panel current without requiring manual refreshes.
        teamsRefreshTimer = setInterval(() => {
            void refreshTeamsStandings();
        }, TEAM_PANEL_REFRESH_INTERVAL_MS);
    };

    /**
     * Clear the timed standings refresh loop when it is no longer needed.
     */
    const clearTeamsRefreshTimer = () => {
        if (teamsRefreshTimer) {
            clearInterval(teamsRefreshTimer);
            teamsRefreshTimer = null;
        }
    };

    /**
     * Merge a newly created submission into the current in-memory snapshot so
     * both sidebar views update immediately without waiting for a manual refresh.
     * @param {object} problem
     * @param {object} submission
     * @returns {Promise<object | null>}
     */
    const mergeSubmissionIntoSnapshot = async (problem, submission) => {
        if (!currentSnapshot) {
            return null;
        }

        const normalizedSubmission = submission.problem
            ? submission
            : {
                ...submission,
                problem: {
                    publicId: problem.publicId,
                    title: problem.title,
                },
            };

        const nextSnapshot = {
            ...currentSnapshot,
            submissions: [
                normalizedSubmission,
                ...currentSnapshot.submissions.filter(entry => entry.id !== normalizedSubmission.id),
            ],
        };

        await syncTreeState(nextSnapshot);
        return nextSnapshot;
    };

    /**
     * Poll the authenticated submissions feed until the created submission
     * leaves a pending state, then refresh the visible tree entry in place.
     * @param {object} problem
     * @param {object} submission
     * @returns {Promise<object>}
     */
    const waitForFinalSubmissionResult = async (problem, submission) => {
        if (!isPendingSubmission(submission?.status) || typeof sessionApi.pollSubmissionResult !== 'function') {
            return submission;
        }

        const waitMessage = `Waiting for the final verdict for submission #${submission.id}.`;
        outputChannel.appendLine(waitMessage);

        return await withProgressNotification(waitMessage, async () => {
            try {
                const finalSubmission = await sessionApi.pollSubmissionResult({
                    baseUrl: resolveBaseUrl(),
                    context,
                    pollIntervalMs: normalizePollIntervalMs(resolvePollIntervalMs()),
                    submissionId: submission.id,
                    timeoutMs: SUBMISSION_POLL_TIMEOUT_MS,
                });

                if (!finalSubmission) {
                    const timeoutMessage = `Submission #${submission.id} is still pending. Refresh the explorer later for the final result.`;
                    outputChannel.appendLine(timeoutMessage);
                    showInformationMessage(timeoutMessage);
                    return submission;
                }

                await mergeSubmissionIntoSnapshot(problem, finalSubmission);

                const finalMessage = `Submission #${finalSubmission.id} finished with ${formatSubmissionStatus(finalSubmission.status)}.`;
                outputChannel.appendLine(finalMessage);
                showInformationMessage(finalMessage);
                return finalSubmission;
            }
            catch (error) {
                if (isSessionEnded(error)) {
                    await handleSessionEnded();
                    return submission;
                }

                const failureMessage = `Submission #${submission.id} polling stopped: ${error.message}`;
                outputChannel.appendLine(failureMessage);
                showErrorMessage(`Could not refresh submission #${submission.id}: ${error.message}`);
                return submission;
            }
        });
    };

    const controller = {
        /**
         * Dispose controller-owned timers.
         */
        dispose() {
            clearTeamsRefreshTimer();
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

            try {
                const code = await withCancellableProgress(
                    WAITING_FOR_BROWSER_MESSAGE,
                    (cancellation) => browserLogin.waitForHandoffCode(cancellation),
                );
                const snapshot = await sessionApi.redeemAndLoadContest({
                    baseUrl: resolveBaseUrl(),
                    code,
                    context,
                });
                sessionEndedPromptShown = false;
                outputChannel.appendLine(`Logged in as ${snapshot.team.name} for ${snapshot.contest.name.trim()}.`);
                return await syncTreeState(snapshot);
            }
            catch (error) {
                if (error instanceof BrowserLoginError && (error.reason === LOGIN_FAILURE.CANCELLED || error.reason === LOGIN_FAILURE.SUPERSEDED)) {
                    outputChannel.appendLine('Login cancelled.');
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
            await sessionApi.clearStoredSession(context);
            outputChannel.appendLine('Logged out of AutoJudge Contest.');
            await syncTreeState(null);
            return null;
        },

        /**
         * Open the contest dashboard in the markdown preview.
         * @returns {Promise<object | null>}
         */
        async openContestDashboard(contest) {
            const selectedContest = await requireSelection(contest, 'contest');
            if (!selectedContest) {
                return null;
            }

            try {
                const dashboardPath = await ensureContestDashboardFile(context, selectedContest);
                const document = await openTextDocument(dashboardPath);

                await executeCommand('markdown.showPreview', document.uri, {
                    preview: true,
                });

                return selectedContest;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open the persisted markdown preview for the selected contest problem.
         * @param {object | undefined | null} problem
         * @returns {Promise<unknown | null>}
         */
        async openProblem(problem) {
            const selectedProblem = await requireSelection(problem, 'problem');
            if (!selectedProblem) {
                return null;
            }

            try {
                const problemPreviewPath = await ensureProblemPreviewFile(context, selectedProblem);
                const document = await openTextDocument(problemPreviewPath);

                // Use the built-in Markdown viewer so the statement renders as
                // formatted Markdown from the persisted file instead of an
                // untitled scratch buffer.
                await executeCommand('markdown.showPreview', document.uri, {
                    preview: true,
                });

                return document;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open the submission details in the markdown preview.
         * @param {object | undefined | null} submission
         * @returns {Promise<object | null>}
         */
        async openSubmission(submission) {
            const selectedSubmission = await requireSelection(submission, 'submission');
            if (!selectedSubmission) {
                return null;
            }

            try {
                const submissionPath = await ensureSubmissionDetailFile(context, selectedSubmission);
                const document = await openTextDocument(submissionPath);

                await executeCommand('markdown.showPreview', document.uri, {
                    preview: true,
                });

                return selectedSubmission;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Open the selected standings entry in the markdown preview.
         * @param {object | undefined | null} team
         * @returns {Promise<object | null>}
         */
        async openTeamStanding(team) {
            const selectedTeam = await requireSelection(team, 'team');
            if (!selectedTeam) {
                return null;
            }

            try {
                const teamPath = await ensureTeamStandingFile(context, selectedTeam, currentSnapshot);
                const document = await openTextDocument(teamPath);

                await executeCommand('markdown.showPreview', document.uri, {
                    preview: true,
                });

                return selectedTeam;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Submit the active editor file for the selected contest problem.
         * @param {object | undefined | null} problem
         * @returns {Promise<object | null>}
         */
        async submitActiveFile(problem) {
            const selectedProblem = await resolveSubmissionProblem(problem);
            if (!selectedProblem) {
                return null;
            }

            try {
                const activeSource = await submissionWorkspace.readActiveSourceFile();
                const submission = await sessionApi.submitSolution({
                    baseUrl: resolveBaseUrl(),
                    code: encodeSourceCode(activeSource.sourceCode),
                    context,
                    filename: activeSource.filename,
                    problemId: resolveRouteId(selectedProblem),
                });

                await mergeSubmissionIntoSnapshot(selectedProblem, submission);
                outputChannel.appendLine(`Submitted ${activeSource.filename} to ${selectedProblem.title.trim()}.`);
                outputChannel.show?.(true);
                notifyInformationMessage(`Submitted ${activeSource.filename} to ${selectedProblem.title.trim()}.`);
                return await waitForFinalSubmissionResult(selectedProblem, submission);
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Export public testcase pairs for the selected contest problem.
         * @param {object | undefined | null} problem
         * @returns {Promise<object | null>}
         */
        async exportPublicCases(problem) {
            const selectedProblem = await resolveSubmissionProblem(problem);
            if (!selectedProblem) {
                return null;
            }

            try {
                const publicCases = extractPublicCases(selectedProblem);
                if (!publicCases.length) {
                    throw new Error(`No public cases available for ${selectedProblem.title.trim()}.`);
                }

                const exportResult = await submissionWorkspace.exportPublicCases(selectedProblem, publicCases);
                outputChannel.appendLine(`Exported ${publicCases.length} public testcase pair${publicCases.length === 1 ? '' : 's'} for ${selectedProblem.title.trim()}.`);
                await showInformationMessage(`Exported ${publicCases.length} public testcase pair${publicCases.length === 1 ? '' : 's'} for ${selectedProblem.title.trim()}.`);
                return exportResult;
            }
            catch (error) {
                return handleFailure(error);
            }
        },

        /**
         * Reload the currently stored contest session, if any.
         * @returns {Promise<object | null>}
         */
        async refreshTree() {
            try {
                const snapshot = await sessionApi.restoreContestSession({
                    baseUrl: resolveBaseUrl(),
                    context,
                });
                if (snapshot) {
                    sessionEndedPromptShown = false;
                    outputChannel.appendLine(`Loaded ${snapshot.contest.name.trim()} for ${snapshot.team.name}.`);
                }
                if (snapshot?.contestNotStarted) {
                    // The session is kept; the tree shows the contest as not started until a refresh finds problems.
                    outputChannel.appendLine(CONTEST_NOT_STARTED_MESSAGE);
                }
                return await syncTreeState(snapshot);
            }
            catch (error) {
                return handleFailure(error);
            }
        },
    };

    return controller;
}

/**
 * Normalize the contributed polling interval setting into a safe positive delay.
 * @param {unknown} value
 * @returns {number}
 */
function normalizePollIntervalMs(value) {
    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue)) {
        return config.POLL_INTERVAL_MS;
    }

    return Math.max(Math.trunc(normalizedValue), 1000);
}

/**
 * Encode the source code to base64 to prepare it for submission.
 * @param {string} sourceCode The raw source code string to encode
 * @returns {string} Encoded source code string
 */
function encodeSourceCode(sourceCode) {
    return Buffer.from(sourceCode, 'utf-8').toString('base64');
}

/**
 * Create the generated markdown preview file for a contest problem when it is
 * missing and return its stable path.
 * @param {object} context
 * @param {{ publicId?: string, title?: string }} problem
 * @returns {Promise<string>}
 */
async function ensureProblemPreviewFile(context, problem) {
    const previewDirectory = join(resolvePreviewRoot(context), 'problem-previews');
    const previewPath = join(previewDirectory, `${toProblemArtifactName(problem)}.md`);

    await mkdir(previewDirectory, { recursive: true });

    await writeFile(previewPath, buildProblemPreviewDocument(problem), {
        encoding: 'utf-8',
    });

    return previewPath;
}

/**
 * Build the complete markdown preview, including a public cases table when
 * sample input/output pairs are available.
 * @param {object} problem
 * @returns {string}
 */
function buildProblemPreviewDocument(problem) {
    const preview = buildProblemPreview(problem);
    const publicCasesTable = buildProblemPublicCasesTable(problem);

    if (!publicCasesTable) {
        return preview;
    }

    return `${preview.trimEnd()}\n\n${publicCasesTable}\n`;
}

/**
 * Render the extracted public input/output pairs as a markdown table.
 * @param {object} problem
 * @returns {string}
 */
function buildProblemPublicCasesTable(problem) {
    const publicCases = extractPublicCases(problem);
    if (!publicCases.length) {
        return '';
    }

    const rows = publicCases.map((testCase, index) => {
        const input = formatMarkdownTableCell(testCase?.input ?? '');
        const output = formatMarkdownTableCell(testCase?.output ?? '');
        return `| ${index + 1} | ${input} | ${output} |`;
    });

    return [
        '## Public Cases',
        '',
        '| Case | Input | Output |',
        '| --- | --- | --- |',
        ...rows,
    ].join('\n');
}

/**
 * Format multiline text so it remains readable inside a markdown table cell.
 * @param {unknown} value
 * @returns {string}
 */
function formatMarkdownTableCell(value) {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.replace(/\|/g, '\\|'))
        .join('<br>');
}

/**
 * Resolve the storage root used for generated problem previews.
 * @param {object} context
 * @returns {string}
 */
function resolvePreviewRoot(context) {
    return context?.storageUri?.fsPath
        ?? context?.globalStorageUri?.fsPath
        ?? join(process.cwd(), '.autojudge-contest');
}

/**
 * Build a stable kebab-case artifact name from the problem title, falling back
 * to the route id when the title is blank.
 * @param {{ publicId?: string, title?: string }} problem
 * @returns {string}
 */
function toProblemArtifactName(problem) {
    const slug = `${problem?.title ?? ''}`
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (slug) {
        return slug;
    }

    const routeId = resolveRouteId(problem);
    return routeId != null ? `problem-${routeId}` : 'problem';
}

/**
 * Create the generated markdown dashboard file for a contest and return its path.
 * @param {object} context
 * @param {object} contest
 * @returns {Promise<string>}
 */
async function ensureContestDashboardFile(context, contest) {
    const previewDirectory = join(resolvePreviewRoot(context), 'contest-dashboards');
    const previewPath = join(previewDirectory, `contest-${resolveRouteId(contest) ?? 'unknown'}.md`);

    await mkdir(previewDirectory, { recursive: true });

    await writeFile(previewPath, renderContestDashboard(contest), {
        encoding: 'utf-8',
    });

    return previewPath;
}

/**
 * Create the generated markdown submission detail file and return its path.
 * @param {object} context
 * @param {object} submission
 * @returns {Promise<string>}
 */
async function ensureSubmissionDetailFile(context, submission) {
    const previewDirectory = join(resolvePreviewRoot(context), 'submission-details');
    const previewPath = join(previewDirectory, `submission-${submission.id}.md`);

    await mkdir(previewDirectory, { recursive: true });

    await writeFile(previewPath, renderSubmissionDetails(submission), {
        encoding: 'utf-8',
    });

    return previewPath;
}

/**
 * Create the generated markdown team standing file and return its path.
 * @param {object} context
 * @param {object} team
 * @param {object | null} currentSnapshot
 * @returns {Promise<string>}
 */
async function ensureTeamStandingFile(context, team, currentSnapshot) {
    const previewDirectory = join(resolvePreviewRoot(context), 'team-details');
    const previewPath = join(previewDirectory, `team-${resolveRouteId(team) ?? 'unknown'}.md`);

    await mkdir(previewDirectory, { recursive: true });

    await writeFile(previewPath, renderTeamStandingDetails(team, currentSnapshot), {
        encoding: 'utf-8',
    });

    return previewPath;
}