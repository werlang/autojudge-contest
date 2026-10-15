import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
    executeCommand: vi.fn(),
    openExternal: vi.fn(),
    registerCommand: vi.fn(),
    registerUriHandler: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    baseUrl: 'https://api.autojudge.test',
    pollIntervalMs: 5000,
    webUrl: 'https://autojudge.io',
    withProgress: vi.fn(),
}));

vi.mock('vscode', () => ({
    commands: {
        executeCommand: vscodeState.executeCommand,
        registerCommand: vscodeState.registerCommand,
    },
    env: {
        openExternal: vscodeState.openExternal,
    },
    ProgressLocation: { Notification: 15, Window: 10 },
    Uri: {
        file: (fsPath) => ({ fsPath, scheme: 'file' }),
        parse: (value) => ({ toString: () => value }),
    },
    window: {
        registerUriHandler: vscodeState.registerUriHandler,
        showErrorMessage: vscodeState.showErrorMessage,
        showInformationMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showTextDocument: vi.fn(),
        showWarningMessage: vscodeState.showWarningMessage,
        withProgress: vscodeState.withProgress,
    },
    workspace: {
        getConfiguration: () => ({
            get: (key, fallbackValue) => (key in vscodeState ? vscodeState[key] : fallbackValue),
        }),
    },
}), { virtual: true });

vi.mock('../src/services/contest-session.js', () => ({
    clearStoredSession: vi.fn(),
    pollSubmissionResults: vi.fn(),
    readStoredSession: vi.fn(),
    redeemAndLoadContest: vi.fn(),
    refreshContestDetails: vi.fn(),
    restoreContestSession: vi.fn(),
    submitSolution: vi.fn(),
}));

import { createSubmissionReveal, registerContestCommands } from '../src/commands/contest-commands.js';
import { COMMANDS } from '../src/constants.js';
import * as contestSession from '../src/services/contest-session.js';

const outputChannel = { appendLine: vi.fn(), show: vi.fn() };

/**
 * Register the contest commands and return the pieces the login flow uses.
 * @returns {{ loginCommand: Function, uriHandler: { handleUri: Function } }}
 */
function registerLogin() {
    registerContestCommands({
        context: {},
        outputChannel,
        teamsStandingsProvider: { setSnapshot: vi.fn() },
        treeProvider: { getSnapshot: vi.fn(() => null), setSnapshot: vi.fn() },
    });

    return {
        loginCommand: vscodeState.registerCommand.mock.calls
            .find(([command]) => command === COMMANDS.LOGIN_TEAM)[1],
        uriHandler: vscodeState.registerUriHandler.mock.calls[0][0],
    };
}

/**
 * Read the `state` query value from the URL passed to the last openExternal call.
 * @returns {string}
 */
function openedState() {
    const opened = vscodeState.openExternal.mock.calls.at(-1)[0].toString();
    return new URL(opened).searchParams.get('state');
}

beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.webUrl = 'https://autojudge.io';
    vscodeState.baseUrl = 'https://api.autojudge.test';
    vscodeState.pollIntervalMs = 5000;
    vscodeState.openExternal.mockResolvedValue(true);
    vscodeState.registerUriHandler.mockReturnValue({ dispose: vi.fn() });
    vscodeState.showWarningMessage.mockResolvedValue(undefined);
    // Like VS Code: run the task with a cancellation token and wait for it.
    vscodeState.withProgress.mockImplementation(async (_options, task) => await task(
        {},
        { onCancellationRequested: vi.fn() },
    ));
    contestSession.restoreContestSession.mockResolvedValue(null);
});

describe('browser team login', () => {
    it('registers a URI handler and no longer asks for a team code or PIN', () => {
        registerLogin();

        expect(vscodeState.registerUriHandler).toHaveBeenCalledTimes(1);
        expect(vscodeState.registerUriHandler.mock.calls[0][0]).toEqual({ handleUri: expect.any(Function) });
    });

    it('opens the web login page with a fresh state under a cancellable progress notification', async () => {
        const { loginCommand, uriHandler } = registerLogin();
        const login = loginCommand();
        await vi.waitFor(() => expect(vscodeState.openExternal).toHaveBeenCalled());

        expect(vscodeState.withProgress).toHaveBeenCalledWith(
            expect.objectContaining({
                cancellable: true,
                location: 15,
                title: 'Complete the login in your browser…',
            }),
            expect.any(Function),
        );
        const opened = new URL(vscodeState.openExternal.mock.calls[0][0].toString());
        expect(opened.origin + opened.pathname).toBe('https://autojudge.io/teams/login');
        expect(opened.searchParams.get('client')).toBe('vscode');
        expect(opened.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // Finish the pending login so no timeout is left running.
        contestSession.redeemAndLoadContest.mockRejectedValue(new Error('stop'));
        uriHandler.handleUri({ path: '/auth', query: `code=handoff-code&state=${openedState()}` });
        await login;
    });

    it('uses the configured web URL', async () => {
        vscodeState.webUrl = 'https://contest.example.test/aj';
        const { loginCommand, uriHandler } = registerLogin();
        const login = loginCommand();
        await vi.waitFor(() => expect(vscodeState.openExternal).toHaveBeenCalled());

        const opened = new URL(vscodeState.openExternal.mock.calls[0][0].toString());
        expect(opened.origin + opened.pathname).toBe('https://contest.example.test/aj/teams/login');

        contestSession.redeemAndLoadContest.mockRejectedValue(new Error('stop'));
        uriHandler.handleUri({ path: '/auth', query: `code=handoff-code&state=${openedState()}` });
        await login;
    });

    it('redeems the code from a matching callback and logs in', async () => {
        contestSession.redeemAndLoadContest.mockResolvedValue({
            contest: { name: 'Regional Final', teams: [] },
            problems: [],
            submissions: [],
            team: { name: 'Bits' },
            token: 'team-jwt-token',
        });
        const { loginCommand, uriHandler } = registerLogin();
        const login = loginCommand();
        await vi.waitFor(() => expect(vscodeState.openExternal).toHaveBeenCalled());

        uriHandler.handleUri({
            path: '/auth',
            query: `code=handoff-code&state=${openedState()}`,
        });
        await login;

        expect(contestSession.redeemAndLoadContest).toHaveBeenCalledWith(expect.objectContaining({
            code: 'handoff-code',
        }));
        expect(vscodeState.executeCommand).toHaveBeenCalledWith('setContext', 'autojudgeContest.state', 'loggedIn');
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
    });

    it('shows an error and ends the login when the browser cannot be opened', async () => {
        vscodeState.openExternal.mockRejectedValue(new Error('No browser available.'));
        const { loginCommand, uriHandler } = registerLogin();

        await loginCommand();

        expect(vscodeState.showErrorMessage).toHaveBeenCalledWith('Could not open the browser to log in.');
        expect(outputChannel.appendLine).toHaveBeenCalledWith('Could not open the browser to log in.');

        // The login is over, so a callback that arrives later has nothing to match.
        uriHandler.handleUri({ path: '/auth', query: 'code=handoff-code&state=late' });
        expect(vscodeState.showWarningMessage).toHaveBeenLastCalledWith('No login in progress. Run Log In again.');
        expect(contestSession.redeemAndLoadContest).not.toHaveBeenCalled();
    });

    it('tells the user when a callback arrives with no login in progress and does not redeem it', () => {
        const { uriHandler } = registerLogin();

        uriHandler.handleUri({ path: '/auth', query: `code=handoff-code&state=${'a'.repeat(43)}` });

        expect(vscodeState.showWarningMessage).toHaveBeenCalledWith('No login in progress. Run Log In again.');
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
        expect(outputChannel.appendLine).toHaveBeenCalledWith('No login in progress. Run Log In again.');
        expect(contestSession.redeemAndLoadContest).not.toHaveBeenCalled();
    });

    it('ignores a callback with a mismatched or missing state, tells the user, and keeps waiting', async () => {
        contestSession.redeemAndLoadContest.mockResolvedValue({
            contest: { name: 'Regional Final', teams: [] },
            problems: [],
            submissions: [],
            team: { name: 'Bits' },
            token: 'team-jwt-token',
        });
        const { loginCommand, uriHandler } = registerLogin();
        const login = loginCommand();
        await vi.waitFor(() => expect(vscodeState.openExternal).toHaveBeenCalled());

        uriHandler.handleUri({ path: '/auth', query: 'code=handoff-code&state=forged' });
        uriHandler.handleUri({ path: '/auth', query: 'code=handoff-code' });

        expect(contestSession.redeemAndLoadContest).not.toHaveBeenCalled();
        expect(vscodeState.showWarningMessage).toHaveBeenCalledTimes(2);
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('did not match'));

        uriHandler.handleUri({ path: '/auth', query: `code=real-code&state=${openedState()}` });
        await login;
        expect(contestSession.redeemAndLoadContest).toHaveBeenCalledWith(expect.objectContaining({ code: 'real-code' }));
    });
});


describe('command glue', () => {
    it('only logs a link that is not a login callback', () => {
        const { uriHandler } = registerLogin();

        uriHandler.handleUri({ path: '/somewhere-else', query: '' });

        expect(outputChannel.appendLine).toHaveBeenCalledWith('Ignored an unknown AutoJudge Contest link.');
        expect(vscodeState.showWarningMessage).not.toHaveBeenCalled();
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
    });

    it('restores silently at startup: a failure with a stored token shows the offline state without a toast', async () => {
        contestSession.restoreContestSession.mockRejectedValue(new Error('fetch failed'));
        contestSession.readStoredSession.mockResolvedValue({ token: 'stored' });

        registerLogin();

        await vi.waitFor(() => expect(vscodeState.executeCommand)
            .toHaveBeenCalledWith('setContext', 'autojudgeContest.state', 'offline'));
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
        expect(vscodeState.withProgress).not.toHaveBeenCalled();
        expect(contestSession.clearStoredSession).not.toHaveBeenCalled();
    });

    it('shows explorer progress for a manual refresh', async () => {
        registerLogin();
        const refreshCommand = vscodeState.registerCommand.mock.calls
            .find(([command]) => command === COMMANDS.REFRESH_TREE)[1];

        await refreshCommand();

        expect(vscodeState.withProgress).toHaveBeenCalledWith(
            { location: { viewId: 'autojudgeContest.explorer' } },
            expect.any(Function),
        );
    });

    it('registers the compare-output command', () => {
        registerLogin();

        expect(vscodeState.registerCommand.mock.calls.map(([command]) => command))
            .toContain(COMMANDS.COMPARE_SUBMISSION_OUTPUT);
    });
});


describe('live settings readers', () => {
    it('imports config without throwing when baseUrl is empty or invalid', async () => {
        vscodeState.baseUrl = '';
        vi.resetModules();

        const configModule = await import('../src/utils/config.js');

        expect(configModule.SUPPORTED_EXTENSIONS).toContain('.py');
        expect(configModule.default).toBeUndefined();
        expect(() => configModule.getBaseUrl()).toThrow('autojudgeContest.baseUrl');
        expect(configModule.getPollIntervalMs()).toBe(5000);
    });

    it('getBaseUrl reads the live value and throws an INVALID_SETTING error when it is invalid', async () => {
        const { getBaseUrl } = await import('../src/utils/config.js');

        vscodeState.baseUrl = 'https://one.test/api/';
        expect(getBaseUrl()).toBe('https://one.test/api/');
        vscodeState.baseUrl = 'https://two.test';
        expect(getBaseUrl()).toBe('https://two.test/');

        vscodeState.baseUrl = 'ftp://two.test';
        let error;
        try {
            getBaseUrl();
        }
        catch (caught) {
            error = caught;
        }
        expect(error.code).toBe('INVALID_SETTING');
        expect(error.setting).toBe('autojudgeContest.baseUrl');
        expect(error.message).toBe('The autojudgeContest.baseUrl setting is not a valid http(s) URL. Fix it in Settings.');
    });

    it('getPollIntervalMs reads live, falls back to 5000 and clamps to at least 1000', async () => {
        const { getPollIntervalMs } = await import('../src/utils/config.js');

        vscodeState.pollIntervalMs = 2500.9;
        expect(getPollIntervalMs()).toBe(2500);
        vscodeState.pollIntervalMs = 10;
        expect(getPollIntervalMs()).toBe(1000);
        vscodeState.pollIntervalMs = 'abc';
        expect(getPollIntervalMs()).toBe(5000);
    });
});

describe('submission reveal', () => {
    const buildReveal = (treeView, findSubmissionItem = vi.fn(() => ({ id: 'submission:5' }))) => ({
        findSubmissionItem,
        reveal: createSubmissionReveal({ treeView, treeProvider: { findSubmissionItem }, outputChannel }),
    });

    it('reveals the submission item expanded, without selecting or focusing, while the explorer is visible', async () => {
        const treeView = { visible: true, reveal: vi.fn().mockResolvedValue(undefined) };
        const { findSubmissionItem, reveal } = buildReveal(treeView);

        await reveal(5);

        expect(findSubmissionItem).toHaveBeenCalledWith(5);
        expect(treeView.reveal).toHaveBeenCalledWith({ id: 'submission:5' }, { select: false, focus: false, expand: true });
    });

    it('does nothing while the explorer is hidden or missing', async () => {
        const hidden = { visible: false, reveal: vi.fn() };

        await buildReveal(hidden).reveal(5);
        await buildReveal(null).reveal(5);

        expect(hidden.reveal).not.toHaveBeenCalled();
    });

    it('skips the reveal when the submission item is not in the tree', async () => {
        const treeView = { visible: true, reveal: vi.fn() };

        await buildReveal(treeView, vi.fn(() => undefined)).reveal(5);

        expect(treeView.reveal).not.toHaveBeenCalled();
    });

    it('swallows reveal errors into the log without a toast', async () => {
        const treeView = { visible: true, reveal: vi.fn().mockRejectedValue(new Error('no element')) };

        await expect(buildReveal(treeView).reveal(5)).resolves.toBeUndefined();

        expect(outputChannel.appendLine).toHaveBeenCalledWith('Could not reveal submission #5: no element');
        expect(vscodeState.showErrorMessage).not.toHaveBeenCalled();
        expect(vscodeState.showWarningMessage).not.toHaveBeenCalled();
    });
});
