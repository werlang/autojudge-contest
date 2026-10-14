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
 * Normalize a team code typed at login. Team public ids are lowercase base36,
 * so surrounding whitespace is trimmed and letters are lowercased before use.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeTeamCode(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * Exchange a team password for a contest team JWT.
 * @param {{ baseUrl: string, password: string, teamId: string, signal?: AbortSignal }} options
 * @returns {Promise<{ token: string }>}
 */
export async function loginTeam({ baseUrl, password, teamId, signal }) {
    return requestJson({
        baseUrl,
        endpoint: `teams/${encodeURIComponent(normalizeTeamCode(teamId))}/login`,
        headers: {
            Authorization: `Bearer ${password}`,
        },
        method: 'POST',
        signal,
    });
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
 * @param {{ baseUrl: string, contestId: number | string, token: string, signal?: AbortSignal }} options
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
 * @param {{ baseUrl: string, contestId: number | string, token: string, signal?: AbortSignal }} options
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
 * @param {{ baseUrl: string, code: string, filename: string, problemId: number | string, token: string, signal?: AbortSignal }} options
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
        error.payload = payload;
        throw error;
    }

    return payload;
}