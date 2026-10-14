import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store.js';
import { getContestDetails, getContestProblems, getCurrentTeam, getSubmissions, isContestNotStarted, redeemHandoffCode, submitSolution as submitContestSolution } from './contest-api.js';
import { isPendingSubmission } from '../utils/submission-status.js';
import { resolveRouteId } from '../utils/public-id.js';
import config from '../utils/config.js';

export { clearStoredSession, readStoredSession, writeStoredSession };

const DEFAULT_SUBMISSION_POLL_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Redeem the one-time code the browser handed over, persist the resulting team
 * token, and load the initial contest snapshot.
 * @param {{ baseUrl: string, code: string, context: import('vscode').ExtensionContext | { secrets: object, globalState: object } }} options
 * @returns {Promise<{ token: string, team: object, problems: object[], submissions: object[] }>}
 */
export async function redeemAndLoadContest({ baseUrl, code, context }) {
    const { token } = await redeemHandoffCode({ baseUrl, code });
    await writeStoredSession(context, { token });

    return loadContestSnapshot({ baseUrl, token });
}

/**
 * Attempt to restore a previously persisted contest session. Rejections are
 * passed to the caller unchanged: only a SESSION_ENDED error means the stored
 * token should be dropped, and that decision belongs to the controller.
 * @param {{ baseUrl: string, context: import('vscode').ExtensionContext | { secrets: object, globalState: object } }} options
 * @returns {Promise<{ token: string, team: object, problems: object[], submissions: object[] } | null>}
 */
export async function restoreContestSession({ baseUrl, context }) {
    const session = await readStoredSession(context);
    if (!session) {
        return null;
    }

    return loadContestSnapshot({
        baseUrl,
        token: session.token,
    });
}

/**
 * Refresh the richer contest details for the active snapshot without reloading
 * problems or submissions. Rejections are passed to the caller unchanged, so a
 * failed request never drops the stored token on its own.
 * @param {{ baseUrl: string, contest: object, context: import('vscode').ExtensionContext | { secrets: object, globalState: object } }} options
 * @returns {Promise<object | null>}
 */
export async function refreshContestDetails({ baseUrl, contest, context }) {
    const session = await readStoredSession(context);
    if (!session?.token) {
        return null;
    }

    try {
        const { contest: detailedContest } = await getContestDetails({
            baseUrl,
            contestId: resolveRouteId(contest),
            token: session.token,
        });

        return mergeContestSnapshot(contest, detailedContest);
    }
    catch (error) {
        // Not started yet: the session is still valid, so keep the snapshot as it is.
        if (isContestNotStarted(error)) {
            return contest;
        }

        throw error;
    }
}

/**
 * Submit source code for a contest problem using the stored team token.
 * @param {{ baseUrl: string, code: string, context: import('vscode').ExtensionContext | { secrets: object, globalState: object }, filename: string, problemId: string }} options
 * @returns {Promise<object>}
 */
export async function submitSolution({ baseUrl, code, context, filename, problemId }) {
    const session = await readStoredSession(context);
    if (!session?.token) {
        throw new Error('Log in to AutoJudge Contest before submitting a solution.');
    }

    const response = await submitContestSolution({
        baseUrl,
        code,
        filename,
        problemId,
        token: session.token,
    });

    return response.submission ?? response;
}

/**
 * Poll the authenticated submission history until one submission reaches a
 * final verdict or the timeout expires.
 * @param {{ baseUrl: string, context: import('vscode').ExtensionContext | { secrets: object, globalState: object }, pollIntervalMs?: number, submissionId: number | string, timeoutMs?: number }} options
 * @returns {Promise<object | null>}
 */
export async function pollSubmissionResult({
    baseUrl,
    context,
    pollIntervalMs = config.POLL_INTERVAL_MS,
    submissionId,
    timeoutMs = DEFAULT_SUBMISSION_POLL_TIMEOUT_MS,
}) {
    const session = await readStoredSession(context);
    if (!session?.token) {
        throw new Error('Log in to AutoJudge Contest before checking a submission result.');
    }

    const startedAt = Date.now();
    const normalizedSubmissionId = submissionId?.toString().trim();
    if (!normalizedSubmissionId) {
        throw new Error('Submission polling requires a submission id.');
    }

    while (Date.now() - startedAt < timeoutMs) {
        // Reuse the authenticated submissions feed so the controller updates the
        // same explorer item shape already rendered elsewhere in the extension.
        const submissionResponse = await getSubmissions({
            baseUrl,
            token: session.token,
        });
        const latestSubmission = (submissionResponse.submissions ?? [])
            .find(entry => entry?.id?.toString().trim() === normalizedSubmissionId);

        if (latestSubmission && !isPendingSubmission(latestSubmission.status)) {
            return latestSubmission;
        }

        if (Date.now() - startedAt + pollIntervalMs >= timeoutMs) {
            break;
        }

        await delay(pollIntervalMs);
    }

    return null;
}

/**
 * Load the authenticated team, contest problems, and submission history. Before
 * the contest starts the server refuses the problem list with
 * `CONTEST_NOT_STARTED`; the snapshot is then returned with no problems and
 * `contestNotStarted` set, so the session is kept and can be refreshed later.
 * @param {{ baseUrl: string, token: string }} options
 * @returns {Promise<{ token: string, team: object, problems: object[], submissions: object[], contestNotStarted: boolean }>}
 */
export async function loadContestSnapshot({ baseUrl, token }) {
    const { team } = await getCurrentTeam({ baseUrl, token });
    const contestId = resolveRouteId(team.contest);
    let contestNotStarted = false;
    const [contestResponse, problemResponse, submissionResponse] = await Promise.all([
        getContestDetails({
            baseUrl,
            contestId,
            token,
        }),
        getContestProblems({
            baseUrl,
            contestId,
            token,
        }).catch((error) => {
            if (!isContestNotStarted(error)) {
                throw error;
            }

            contestNotStarted = true;
            return { problems: [] };
        }),
        getSubmissions({
            baseUrl,
            token,
        }),
    ]);

    return {
        problems: problemResponse.problems,
        submissions: submissionResponse.submissions,
        team: {
            ...team,
        },
        contest: mergeContestSnapshot(team.contest, contestResponse.contest),
        contestNotStarted,
        token,
    };
}

/**
 * Merge the summary contest fields from `GET /teams` with the richer details
 * payload returned by `GET /contests/:id`.
 * @param {object | undefined | null} summaryContest
 * @param {object | undefined | null} detailedContest
 * @returns {object}
 */
function mergeContestSnapshot(summaryContest, detailedContest) {
    return {
        ...summaryContest,
        ...detailedContest,
    };
}

/**
 * Delay the next submission refresh without busy-waiting the extension host.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, Math.max(ms, 0));
    });
}