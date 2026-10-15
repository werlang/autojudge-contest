/**
 * Error code the server sends when a team session is no longer valid: another
 * login replaced it, staff reset the PIN, or the contest window closed.
 */
export const SESSION_ENDED_CODE = 'SESSION_ENDED';

/**
 * Error code the server sends when a hand-off code is unknown, expired or
 * already used.
 */
export const HANDOFF_INVALID_CODE = 'HANDOFF_INVALID';

/**
 * Error code the server sends (with 403) for contest problems before the contest
 * starts. The team session is still valid, so it is kept.
 */
export const CONTEST_NOT_STARTED_CODE = 'CONTEST_NOT_STARTED';

/**
 * Error code attached to errors caused by an invalid `autojudgeContest.*`
 * setting. `error.setting` names the offending setting so callers can offer to
 * open it in Settings.
 */
export const INVALID_SETTING_CODE = 'INVALID_SETTING';

/**
 * How long one API request may take before it is aborted, so a hung server
 * never leaves a view loading forever.
 */
export const REQUEST_TIMEOUT_MS = 20 * 1000;

const REQUEST_TIMEOUT_MESSAGE = 'The AutoJudge server did not respond in time.';

/**
 * Build the friendly error thrown for an invalid URL setting.
 * @param {string} setting full setting id, e.g. `autojudgeContest.baseUrl`
 * @returns {Error & { code: string, setting: string }}
 */
export function createInvalidSettingError(setting) {
    const error = new Error(`The ${setting} setting is not a valid http(s) URL. Fix it in Settings.`);
    error.code = INVALID_SETTING_CODE;
    error.setting = setting;
    return error;
}

/**
 * Normalize the contest API base URL while preserving optional base paths.
 * @param {string} value
 * @returns {string}
 * @throws {Error} with `code` INVALID_SETTING when the value is empty, unparsable or not http(s)
 */
export function normalizeBaseUrl(value) {
    const trimmed = String(value ?? '').trim();
    let url;

    try {
        url = new URL(trimmed);
    }
    catch {
        throw createInvalidSettingError('autojudgeContest.baseUrl');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw createInvalidSettingError('autojudgeContest.baseUrl');
    }

    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname ? `${pathname}/` : '/';
    return url.toString();
}

/**
 * Exchange the one-time hand-off code the browser delivered for the team's
 * session token. The token is the same one the browser holds (same session id),
 * so no credentials pass through the extension.
 * @param {{ baseUrl: string, code: string, signal?: AbortSignal }} options
 * @returns {Promise<{ token: string }>}
 */
export async function redeemHandoffCode({ baseUrl, code, signal }) {
    return requestJson({
        baseUrl,
        body: { code },
        endpoint: 'teams/session/redeem',
        headers: {
            'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
    });
}

/**
 * Check whether a failed request means the team session is over, whatever call
 * produced it.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSessionEnded(error) {
    return error?.statusCode === 401 && error?.code === SESSION_ENDED_CODE;
}

/**
 * Fetch the team represented by the stored contest JWT.
 * @param {{ baseUrl: string, token: string, signal?: AbortSignal }} options
 * @returns {Promise<{ team: object }>}
 */
export async function getCurrentTeam({ baseUrl, token, signal }) {
    return requestJson({
        baseUrl,
        endpoint: 'teams',
        headers: buildAuthHeaders(token),
        method: 'GET',
        signal,
    });
}

/**
 * Check whether a failed request only means the contest has not started yet.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isContestNotStarted(error) {
    return error?.statusCode === 403 && error?.code === CONTEST_NOT_STARTED_CODE;
}

/**
 * Fetch the authenticated team's contest details.
 * @param {{ baseUrl: string, contestId: string, token: string, signal?: AbortSignal }} options
 * @returns {Promise<{ contest: object }>}
 */
export async function getContestDetails({ baseUrl, contestId, token, signal }) {
    return requestJson({
        baseUrl,
        endpoint: `contests/${contestId}`,
        headers: buildAuthHeaders(token),
        method: 'GET',
        signal,
    });
}

/**
 * Fetch the contest-visible problem list for the authenticated team.
 * @param {{ baseUrl: string, contestId: string, token: string, signal?: AbortSignal }} options
 * @returns {Promise<{ problems: object[] }>}
 */
export async function getContestProblems({ baseUrl, contestId, token, signal }) {
    return requestJson({
        baseUrl,
        endpoint: `contests/${contestId}/problems`,
        headers: buildAuthHeaders(token),
        method: 'GET',
        signal,
    });
}

/**
 * Fetch the authenticated team's submission history.
 * @param {{ baseUrl: string, token: string, signal?: AbortSignal }} options
 * @returns {Promise<{ submissions: object[] }>}
 */
export async function getSubmissions({ baseUrl, token, signal }) {
    return requestJson({
        baseUrl,
        endpoint: 'submissions',
        headers: buildAuthHeaders(token),
        method: 'GET',
        signal,
    });
}

/**
 * Submit source code for one contest problem as the authenticated team.
 * @param {{ baseUrl: string, code: string, filename: string, problemId: string, token: string, signal?: AbortSignal }} options
 * @returns {Promise<{ submission?: object } | object>}
 */
export async function submitSolution({ baseUrl, code, filename, problemId, token, signal }) {
    return requestJson({
        baseUrl,
        body: {
            code,
            filename,
            problemId,
        },
        endpoint: `problems/${problemId}/judge`,
        headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
    });
}

/**
 * Build a contest API endpoint against the configured base URL.
 * @param {string} baseUrl
 * @param {string} endpoint
 * @returns {string}
 */
function buildEndpointUrl(baseUrl, endpoint) {
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    return new URL(cleanEndpoint, normalizeBaseUrl(baseUrl)).toString();
}

/**
 * Create the auth header required by the contest team endpoints.
 * @param {string} token
 * @returns {{ Authorization: string }}
 */
function buildAuthHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
    };
}

/**
 * Combine the request timeout with an optional caller signal (logout, poll
 * stop). VS Code ^1.90 runs on Node >= 20.9, which has both
 * `AbortSignal.timeout` and `AbortSignal.any`.
 * @param {AbortSignal | undefined} signal
 * @returns {{ signal: AbortSignal, timeoutSignal: AbortSignal }}
 */
function withRequestTimeout(signal) {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return {
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        timeoutSignal,
    };
}

/**
 * Execute a JSON API request and preserve the backend message on failure. A
 * request (body read included) that runs past REQUEST_TIMEOUT_MS rejects with
 * a clear error; a caller abort rejects with the fetch AbortError unchanged.
 * @param {{ baseUrl: string, endpoint: string, headers?: Record<string, string>, method: string, signal?: AbortSignal, body?: unknown }} options
 * @returns {Promise<any>}
 */
async function requestJson({ baseUrl, endpoint, headers, method, signal, body }) {
    const url = buildEndpointUrl(baseUrl, endpoint);
    const timeout = withRequestTimeout(signal);
    let response;
    let payload;

    try {
        response = await fetch(url, {
            body: body == null ? undefined : JSON.stringify(body),
            headers,
            method,
            signal: timeout.signal,
        });
        payload = await response.json().catch((error) => {
            // An abort while reading the body (timeout, logout) must fail the
            // request; only an unparsable body falls back to an empty payload.
            if (timeout.signal.aborted) {
                throw error;
            }

            return {};
        });
    }
    catch (error) {
        if (timeout.timeoutSignal.aborted && !signal?.aborted) {
            throw new Error(REQUEST_TIMEOUT_MESSAGE);
        }

        throw error;
    }

    if (!response.ok) {
        const error = new Error(payload.message || 'AutoJudge Contest request failed.');
        error.statusCode = response.status;
        error.code = payload.code;
        error.payload = payload;
        throw error;
    }

    return payload;
}
