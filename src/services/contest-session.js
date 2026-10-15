import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store.js';
import { getContestDetails, getContestProblems, getCurrentTeam, getSubmissions, isContestNotStarted, isSessionEnded, redeemHandoffCode, submitSolution as submitContestSolution } from './contest-api.js';
import { isPendingSubmission } from '../utils/submission-status.js';
import { resolveRouteId } from '../utils/public-id.js';
import { getPollIntervalMs } from '../utils/config.js';

export { clearStoredSession, readStoredSession, writeStoredSession };

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
 * Poll the authenticated submission history for a changing set of pending
 * submissions with ONE request per interval, however many are pending. The
 * caller owns the set through `tracker`:
 * - `ids()` returns the ids still wanted (read before every request; the caller
 *   drops timed-out ids there). The loop ends once it is empty.
 * - `resolve(submission)` receives each wanted submission that reached a final verdict.
 * - `onError(error)` reports a failed request; polling retries it next interval.
 * - `onSuccess()` reports a request that succeeded (e.g. to re-arm error logging).
 * A SESSION_ENDED failure is rethrown, and an aborted `signal` (logout, session
 * end, deactivation) ends the loop and cancels the request in flight.
 * @param {{ baseUrl: string, context: import('vscode').ExtensionContext | { secrets: object, globalState: object }, pollIntervalMs?: number, signal?: AbortSignal, tracker: { ids: () => Array<number | string>, resolve: (submission: object) => Promise<void> | void, onError?: (error: Error) => void, onSuccess?: () => void } }} options
 * @returns {Promise<void>}
 */
export async function pollSubmissionResults({
    baseUrl,
    context,
    pollIntervalMs = getPollIntervalMs(),
    signal,
    tracker,
}) {
    const session = await readStoredSession(context);
    if (!session?.token) {
        throw new Error('Log in to AutoJudge Contest before checking a submission result.');
    }

    while (!signal?.aborted) {
        const wanted = new Set(tracker.ids().map(id => String(id).trim()));
        if (!wanted.size) {
            return;
        }

        try {
            const { submissions } = await getSubmissions({ baseUrl, signal, token: session.token });
            tracker.onSuccess?.();
            for (const submission of submissions ?? []) {
                const id = submission?.id?.toString().trim();
                if (wanted.has(id) && !isPendingSubmission(submission.status)) {
                    await tracker.resolve(submission);
                }
            }
        }
        catch (error) {
            if (signal?.aborted) {
                return;
            }

            if (isSessionEnded(error)) {
                throw error;
            }

            // A network blip or server error: keep polling.
            tracker.onError?.(error);
        }

        await delay(pollIntervalMs, signal);
    }
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
 * Resolves early when `signal` is aborted so a stopped poll ends promptly.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) {
            resolve();
            return;
        }

        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, Math.max(ms, 0));
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}