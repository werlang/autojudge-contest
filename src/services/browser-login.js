import { randomBytes } from 'node:crypto';

/**
 * Path (on the `vscode://autojudge.autojudge-contest` URI) the web app redirects
 * to once a team confirmed the connection.
 */
export const AUTH_URI_PATH = '/auth';

/**
 * How long a started login waits for the browser to come back.
 */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const STATE_BYTES = 32;
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Why a browser login ended without a hand-off code.
 */
export const LOGIN_FAILURE = Object.freeze({
    CANCELLED: 'cancelled',
    OPEN_FAILED: 'open-failed',
    SUPERSEDED: 'superseded',
    TIMEOUT: 'timeout',
});

/**
 * Error raised when a browser login ends without a hand-off code.
 */
export class BrowserLoginError extends Error {
    /**
     * @param {string} reason one of {@link LOGIN_FAILURE}
     * @param {string} message
     */
    constructor(reason, message) {
        super(message);
        this.name = 'BrowserLoginError';
        this.reason = reason;
    }
}

/**
 * Normalize the configured web app URL. Only http(s) addresses are accepted
 * because the result is handed to the system browser.
 * @param {string} value
 * @returns {string} URL with a trailing slash
 */
export function normalizeWebUrl(value) {
    const trimmed = String(value ?? '').trim();
    let url;

    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error('Set autojudgeContest.webUrl to a valid AutoJudge web address.');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('Set autojudgeContest.webUrl to a valid AutoJudge web address.');
    }

    url.search = '';
    url.hash = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
}

/**
 * Build the browser page the extension opens to start a login. `state` is
 * echoed back unchanged by the web app and proves the callback belongs to this
 * request.
 * @param {string} webUrl configured web app address
 * @param {string} state
 * @returns {string}
 */
export function buildBrowserLoginUrl(webUrl, state) {
    const url = new URL('teams/login', normalizeWebUrl(webUrl));
    url.searchParams.set('client', 'vscode');
    url.searchParams.set('state', state);
    return url.toString();
}

/**
 * Generate an unguessable `state` value: 256 random bits as base64url.
 * @returns {string}
 */
export function generateLoginState() {
    return randomBytes(STATE_BYTES).toString('base64url');
}

/**
 * Coordinate the browser login: open the web login page with a fresh `state`,
 * keep exactly one login pending, and turn the `vscode://` callback into the
 * one-time hand-off code. Redeeming the code is left to the caller.
 */
export class BrowserLogin {
    /**
     * @param {object} options
     * @param {(url: string) => Promise<boolean> | boolean} options.openExternal opens a URL in the system browser
     * @param {() => string} options.resolveWebUrl returns the configured web app address
     * @param {() => string} [options.createState] state generator, replaceable in tests
     * @param {number} [options.timeoutMs]
     */
    constructor({ openExternal, resolveWebUrl, createState = generateLoginState, timeoutMs = LOGIN_TIMEOUT_MS }) {
        this.openExternal = openExternal;
        this.resolveWebUrl = resolveWebUrl;
        this.createState = createState;
        this.timeoutMs = timeoutMs;
        this.pending = null;
    }

    /**
     * Start a login and wait for the browser to deliver the hand-off code. A
     * login that is still pending is superseded, so only one state is ever
     * accepted.
     * @param {{ onCancellationRequested?: (listener: () => void) => unknown } | undefined} [cancellation]
     * @returns {Promise<string>} the one-time hand-off code
     * @throws {BrowserLoginError}
     */
    async waitForHandoffCode(cancellation) {
        const state = this.createState();
        const url = buildBrowserLoginUrl(this.resolveWebUrl(), state);

        this.#end(new BrowserLoginError(LOGIN_FAILURE.SUPERSEDED, 'Another login was started.'));

        const pending = { state };
        pending.promise = new Promise((resolve, reject) => {
            pending.resolve = resolve;
            pending.reject = reject;
        });
        pending.timer = setTimeout(() => {
            this.#end(new BrowserLoginError(LOGIN_FAILURE.TIMEOUT, 'The browser login timed out. Run Login Team again.'), pending);
        }, this.timeoutMs);
        this.pending = pending;

        cancellation?.onCancellationRequested?.(() => {
            this.#end(new BrowserLoginError(LOGIN_FAILURE.CANCELLED, 'Login cancelled.'), pending);
        });

        const opened = await this.openExternal(url);
        if (opened === false) {
            this.#end(new BrowserLoginError(LOGIN_FAILURE.OPEN_FAILED, 'Could not open the browser to log in.'), pending);
        }

        return pending.promise;
    }

    /**
     * Handle the `vscode://` callback. The callback is accepted only when a
     * login is pending and its `state` matches; anything else is ignored and
     * leaves the pending login untouched.
     * @param {{ path: string, query: string }} uri
     * @returns {{ accepted: true } | { accepted: false, reason: string }}
     */
    handleUri(uri) {
        if (uri?.path !== AUTH_URI_PATH) {
            return { accepted: false, reason: 'Ignored an unknown AutoJudge Contest link.' };
        }

        if (!this.pending) {
            return { accepted: false, reason: 'No login in progress. Run Login Team again.' };
        }

        const params = new URLSearchParams(uri.query ?? '');
        const state = params.get('state');
        const code = params.get('code');

        if (!state || state !== this.pending.state) {
            return { accepted: false, reason: 'Ignored a login link that did not match the login in progress.' };
        }

        if (!code || !CODE_PATTERN.test(code)) {
            return { accepted: false, reason: 'Ignored a login link without a valid code.' };
        }

        const { resolve } = this.pending;
        this.#settle();
        resolve(code);
        return { accepted: true };
    }

    /**
     * Drop the pending login, if any, without a result.
     */
    dispose() {
        this.#end(new BrowserLoginError(LOGIN_FAILURE.CANCELLED, 'Login cancelled.'));
    }

    /**
     * Reject and clear the pending login. When `expected` is given, only that
     * login is ended, so a stale timer or cancel cannot kill a newer login.
     * @param {BrowserLoginError} error
     * @param {object} [expected]
     */
    #end(error, expected) {
        if (!this.pending || (expected && this.pending !== expected)) {
            return;
        }

        const { reject } = this.pending;
        this.#settle();
        reject(error);
    }

    /**
     * Forget the pending login and stop its timeout.
     */
    #settle() {
        clearTimeout(this.pending.timer);
        this.pending = null;
    }
}
