import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
    executeCommand: vi.fn(),
    registerCommand: vi.fn(),
    showInputBox: vi.fn(),
}));

vi.mock('vscode', () => ({
    commands: {
        executeCommand: vscodeState.executeCommand,
        registerCommand: vscodeState.registerCommand,
    },
    ProgressLocation: { Notification: 15 },
    window: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showInputBox: vscodeState.showInputBox,
        withProgress: vi.fn(),
    },
    workspace: {
        getConfiguration: () => ({
            get: (_key, fallbackValue) => fallbackValue,
        }),
    },
}), { virtual: true });

vi.mock('../src/services/contest-session.js', () => ({
    clearStoredSession: vi.fn(),
    loginAndLoadContest: vi.fn(),
    pollSubmissionResult: vi.fn(),
    refreshContestDetails: vi.fn(),
    restoreContestSession: vi.fn(),
    submitSolution: vi.fn(),
}));

import { registerContestCommands } from '../src/commands/contest-commands.js';
import { COMMANDS } from '../src/constants.js';
import * as contestSession from '../src/services/contest-session.js';

/**
 * Register the contest commands and return the login command callback.
 * @returns {Function}
 */
function registerLoginCommand() {
    registerContestCommands({
        context: {},
        outputChannel: { appendLine: vi.fn(), show: vi.fn() },
        teamsStandingsProvider: { setSnapshot: vi.fn() },
        treeProvider: { getSnapshot: vi.fn(() => null), setSnapshot: vi.fn() },
    });

    return vscodeState.registerCommand.mock.calls
        .find(([command]) => command === COMMANDS.LOGIN_TEAM)[1];
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('team login prompt', () => {
    it('asks for a team code and normalizes it before logging in', async () => {
        const loginCommand = registerLoginCommand();
        vscodeState.showInputBox
            .mockResolvedValueOnce('  K3M9X2P7Q8W1A ')
            .mockResolvedValueOnce('123456');
        contestSession.loginAndLoadContest.mockResolvedValue({
            problems: [],
            submissions: [],
            team: { name: 'Bits' },
            contest: { name: 'Regional Final', teams: [] },
            token: 'team-jwt-token',
        });

        await loginCommand();

        expect(vscodeState.showInputBox).toHaveBeenNthCalledWith(1, expect.objectContaining({
            placeHolder: 'team-code',
            prompt: 'Enter your AutoJudge team code (printed on your team card).',
        }));
        expect(contestSession.loginAndLoadContest).toHaveBeenCalledWith(expect.objectContaining({
            password: '123456',
            teamId: 'k3m9x2p7q8w1a',
        }));
    });

    it('validates the team code in the input box and rejects a legacy six-character hash', async () => {
        const loginCommand = registerLoginCommand();
        vscodeState.showInputBox.mockResolvedValueOnce('ab12cd');

        await loginCommand();

        const { validateInput } = vscodeState.showInputBox.mock.calls[0][0];
        expect(validateInput('ab12cd')).toMatch(/13-character team code/);
        expect(validateInput('  K3M9X2P7Q8W1A ')).toBeNull();
        expect(contestSession.loginAndLoadContest).not.toHaveBeenCalled();
    });

    it('cancels the login when the team code is blank after trimming', async () => {
        const loginCommand = registerLoginCommand();
        vscodeState.showInputBox.mockResolvedValueOnce('   ');

        await loginCommand();

        expect(vscodeState.showInputBox).toHaveBeenCalledTimes(1);
        expect(contestSession.loginAndLoadContest).not.toHaveBeenCalled();
    });
});
