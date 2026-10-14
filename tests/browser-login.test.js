import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserLogin,
    BrowserLoginError,
    LOGIN_FAILURE,
    LOGIN_TIMEOUT_MS,
    buildBrowserLoginUrl,
    generateLoginState,
    normalizeWebUrl,
} from '../src/services/browser-login.js';

const STATE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

/**
 * Build a `vscode://` callback URI the way the web app redirects to it.
 * @param {Record<string, string>} params
 * @param {string} [path]
 * @returns {{ path: string, query: string }}
 */
function callback(params, path = '/auth') {
    return { path, query: new URLSearchParams(params).toString() };
}

describe('generateLoginState', () => {
    it('produces unguessable base64url values the web app accepts', () => {
        const first = generateLoginState();
        const second = generateLoginState();

        expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(first.length).toBeGreaterThanOrEqual(43);
        expect(first).not.toBe(second);
    });
});

describe('normalizeWebUrl', () => {
    it('keeps a base path and ends with exactly one slash', () => {
        expect(normalizeWebUrl(' https://autojudge.io ')).toBe('https://autojudge.io/');
        expect(normalizeWebUrl('https://example.test/aj///')).toBe('https://example.test/aj/');
    });

    it('rejects blank values, non-URLs and non-http schemes', () => {
        expect(() => normalizeWebUrl('')).toThrow('autojudgeContest.webUrl');
        expect(() => normalizeWebUrl('not a url')).toThrow('autojudgeContest.webUrl');
        expect(() => normalizeWebUrl('file:///etc/passwd')).toThrow('autojudgeContest.webUrl');
        expect(() => normalizeWebUrl('vscode://autojudge.autojudge-contest/auth')).toThrow('autojudgeContest.webUrl');
    });
});

describe('buildBrowserLoginUrl', () => {
    it('targets the team login page for the vscode client with the state', () => {
        expect(buildBrowserLoginUrl('https://autojudge.io', STATE))
            .toBe(`https://autojudge.io/teams/login?client=vscode&state=${STATE}`);
    });

    it('keeps a configured base path', () => {
        expect(buildBrowserLoginUrl('https://example.test/aj/', STATE))
            .toBe(`https://example.test/aj/teams/login?client=vscode&state=${STATE}`);
    });
});

describe('BrowserLogin', () => {
    let openExternal;
    let login;

    beforeEach(() => {
        vi.useFakeTimers();
        openExternal = vi.fn(async () => true);
        login = new BrowserLogin({
            createState: () => STATE,
            openExternal,
            resolveWebUrl: () => 'https://autojudge.io',
        });
    });

    afterEach(() => {
        login.dispose();
        vi.useRealTimers();
    });

    /**
     * Start a login and let the browser open call settle.
     * @param {object} [cancellation]
     * @returns {Promise<string>}
     */
    async function startLogin(cancellation) {
        const result = login.waitForHandoffCode(cancellation);
        // Observe rejections right away so a failing test never leaks them.
        result.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);
        return result;
    }

    it('opens the browser login URL with the generated state', async () => {
        const result = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);

        expect(openExternal).toHaveBeenCalledTimes(1);
        expect(openExternal).toHaveBeenCalledWith(`https://autojudge.io/teams/login?client=vscode&state=${STATE}`);

        login.handleUri(callback({ code: 'handoff-code', state: STATE }));
        await expect(result).resolves.toBe('handoff-code');
    });

    it('resolves with the code when the callback state matches', async () => {
        const result = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);

        expect(login.handleUri(callback({ code: 'abc_DEF-123', state: STATE }))).toEqual({ accepted: true });
        await expect(result).resolves.toBe('abc_DEF-123');
    });

    it('rejects a callback with the wrong state and keeps the login pending', async () => {
        const result = login.waitForHandoffCode();
        const settled = vi.fn();
        result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(0);

        const outcome = login.handleUri(callback({ code: 'stolen-code', state: 'someone-elses-state-value' }));

        expect(outcome.accepted).toBe(false);
        expect(outcome.reason).toMatch(/did not match/);
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).not.toHaveBeenCalled();

        expect(login.handleUri(callback({ code: 'real-code', state: STATE }))).toEqual({ accepted: true });
        await expect(result).resolves.toBe('real-code');
    });

    it('rejects a callback without a state', async () => {
        const result = login.waitForHandoffCode();
        result.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);

        expect(login.handleUri(callback({ code: 'handoff-code' })).accepted).toBe(false);
        expect(login.handleUri(callback({ code: 'handoff-code', state: '' })).accepted).toBe(false);
    });

    it('rejects a callback without a usable code', async () => {
        const result = login.waitForHandoffCode();
        result.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);

        expect(login.handleUri(callback({ state: STATE })).accepted).toBe(false);
        expect(login.handleUri(callback({ code: 'has spaces', state: STATE })).accepted).toBe(false);
        expect(login.handleUri(callback({ code: 'x'.repeat(513), state: STATE })).accepted).toBe(false);
    });

    it('rejects callbacks on other paths and callbacks when no login is pending', async () => {
        expect(login.handleUri(callback({ code: 'c', state: STATE })).accepted).toBe(false);

        const result = login.waitForHandoffCode();
        result.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);

        expect(login.handleUri(callback({ code: 'c', state: STATE }, '/other')).accepted).toBe(false);
    });

    it('explains a callback that arrives with no login in progress', () => {
        expect(login.handleUri(callback({ code: 'c', state: STATE }))).toEqual({
            accepted: false,
            reason: 'No login in progress. Run Login Team again.',
        });
    });

    it('accepts a state only once', async () => {
        const result = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);
        login.handleUri(callback({ code: 'first', state: STATE }));
        await result;

        expect(login.handleUri(callback({ code: 'second', state: STATE })).accepted).toBe(false);
    });

    it('times out after five minutes and then rejects a late callback', async () => {
        expect(LOGIN_TIMEOUT_MS).toBe(5 * 60 * 1000);
        const result = startLogin();
        const assertion = expect(result).rejects.toMatchObject({ reason: LOGIN_FAILURE.TIMEOUT });

        await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS - 1);
        expect(login.pending).not.toBeNull();
        await vi.advanceTimersByTimeAsync(1);

        await assertion;
        expect(login.handleUri(callback({ code: 'late', state: STATE })).accepted).toBe(false);
    });

    it('rejects as cancelled when the progress notification is cancelled', async () => {
        let cancel;
        const cancellation = { onCancellationRequested: (listener) => { cancel = listener; } };
        const result = startLogin(cancellation);
        const assertion = expect(result).rejects.toMatchObject({ reason: LOGIN_FAILURE.CANCELLED });

        cancel();

        await assertion;
        expect(login.handleUri(callback({ code: 'late', state: STATE })).accepted).toBe(false);
    });

    it('keeps one pending login: a new login supersedes the old one and its state', async () => {
        const states = ['first-state-aaaaaaaaaaaaaaaa', 'second-state-bbbbbbbbbbbbbbbb'];
        login = new BrowserLogin({
            createState: () => states.shift(),
            openExternal,
            resolveWebUrl: () => 'https://autojudge.io',
        });

        const first = login.waitForHandoffCode();
        const firstAssertion = expect(first).rejects.toMatchObject({ reason: LOGIN_FAILURE.SUPERSEDED });
        await vi.advanceTimersByTimeAsync(0);
        const second = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);

        await firstAssertion;
        expect(login.handleUri(callback({ code: 'old', state: 'first-state-aaaaaaaaaaaaaaaa' })).accepted).toBe(false);
        expect(login.handleUri(callback({ code: 'new', state: 'second-state-bbbbbbbbbbbbbbbb' })).accepted).toBe(true);
        await expect(second).resolves.toBe('new');
    });

    it('does not let a stale cancel or timeout of a replaced login end the new one', async () => {
        let cancelFirst;
        const states = ['first-state-aaaaaaaaaaaaaaaa', 'second-state-bbbbbbbbbbbbbbbb'];
        login = new BrowserLogin({
            createState: () => states.shift(),
            openExternal,
            resolveWebUrl: () => 'https://autojudge.io',
        });

        login.waitForHandoffCode({ onCancellationRequested: (listener) => { cancelFirst = listener; } }).catch(() => {});
        await vi.advanceTimersByTimeAsync(0);
        const second = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);

        cancelFirst();
        expect(login.pending).not.toBeNull();
        login.handleUri(callback({ code: 'new', state: 'second-state-bbbbbbbbbbbbbbbb' }));
        await expect(second).resolves.toBe('new');
    });

    it('fails when the system browser could not be opened', async () => {
        openExternal.mockResolvedValue(false);

        await expect(login.waitForHandoffCode()).rejects.toMatchObject({
            reason: LOGIN_FAILURE.OPEN_FAILED,
        });
        expect(login.pending).toBeNull();
    });

    it('ends the pending login and its timeout when opening the browser throws', async () => {
        openExternal.mockRejectedValue(new Error('No browser available.'));

        await expect(login.waitForHandoffCode()).rejects.toMatchObject({
            message: 'Could not open the browser to log in.',
            reason: LOGIN_FAILURE.OPEN_FAILED,
        });
        expect(login.pending).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fails before opening anything when the web URL setting is invalid', async () => {
        login = new BrowserLogin({ openExternal, resolveWebUrl: () => 'ftp://autojudge.io' });

        await expect(login.waitForHandoffCode()).rejects.toThrow('autojudgeContest.webUrl');
        expect(openExternal).not.toHaveBeenCalled();
    });

    it('uses BrowserLoginError for every failure reason', async () => {
        const result = login.waitForHandoffCode();
        await vi.advanceTimersByTimeAsync(0);
        login.dispose();

        await expect(result).rejects.toBeInstanceOf(BrowserLoginError);
    });
});
