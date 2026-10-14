import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
    executeCommand: vi.fn(),
    openExternal: vi.fn(),
    registerCommand: vi.fn(),
    registerUriHandler: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
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
    ProgressLocation: { Notification: 15 },
    Uri: {
        parse: (value) => ({ toString: () => value }),
    },
    window: {
        registerUriHandler: vscodeState.registerUriHandler,
        showErrorMessage: vscodeState.showErrorMessage,
        showInformationMessage: vi.fn(),
        showWarningMessage: vscodeState.showWarningMessage,
        withProgress: vscodeState.withProgress,
    },
    workspace: {
        getConfiguration: () => ({
            get: (key, fallbackValue) => (key === 'webUrl' ? vscodeState.webUrl : fallbackValue),
        }),
    },
}), { virtual: true });

vi.mock('../src/services/contest-session.js', () => ({
    clearStoredSession: vi.fn(),
    pollSubmissionResult: vi.fn(),
    redeemAndLoadContest: vi.fn(),
    refreshContestDetails: vi.fn(),
    restoreContestSession: vi.fn(),
    submitSolution: vi.fn(),
}));

import { registerContestCommands } from '../src/commands/contest-commands.js';
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
                title: 'Waiting for you to log in in the browser…',
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
        expect(vscodeState.showErrorMessage).toHaveBeenCalledTimes(2);
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('did not match'));

        uriHandler.handleUri({ path: '/auth', query: `code=real-code&state=${openedState()}` });
        await login;
        expect(contestSession.redeemAndLoadContest).toHaveBeenCalledWith(expect.objectContaining({ code: 'real-code' }));
    });
});
