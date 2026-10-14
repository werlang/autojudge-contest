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
 * Normalize the contest API base URL while preserving optional base paths.
 * @param {string} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
    if (!value || !value.trim()) {
        throw new Error('Set autojudgeContest.baseUrl to a valid AutoJudge API URL.');
    }

    const url = new URL(value.trim());
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
 * Execute a JSON API request and preserve the backend message on failure.
 * @param {{ baseUrl: string, endpoint: string, headers?: Record<string, string>, method: string, signal?: AbortSignal, body?: unknown }} options
 * @returns {Promise<any>}
 */
async function requestJson({ baseUrl, endpoint, headers, method, signal, body }) {
    const response = await fetch(buildEndpointUrl(baseUrl, endpoint), {
        body: body == null ? undefined : JSON.stringify(body),
        headers,
        method,
        signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.message || 'AutoJudge Contest request failed.');
        error.statusCode = response.status;
        error.code = payload.code;
        error.payload = payload;
        throw error;
    }

    return payload;
}