import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const subscriptions = [];
const registeredCommands = [];
const createdTreeViews = [];

const createOutputChannel = vi.fn(() => ({
    appendLine: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    show: vi.fn(),
}));

const registerCommand = vi.fn((command, callback) => {
    registeredCommands.push({ command, callback });
    return { dispose: vi.fn() };
});

const executeCommand = vi.fn();

const createTreeView = vi.fn((viewId, options) => {
    createdTreeViews.push({ viewId, options });
    return { dispose: vi.fn() };
});

const registerUriHandler = vi.fn(() => ({ dispose: vi.fn() }));

const createStatusBarItem = vi.fn(() => ({
    dispose: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
}));

const getConfiguration = vi.fn(() => ({
    get: (_key, fallbackValue) => fallbackValue,
}));

vi.mock('vscode', () => ({
    commands: {
        executeCommand,
        registerCommand,
    },
    env: {
        openExternal: vi.fn(),
    },
    Uri: {
        parse: vi.fn(),
    },
    ProgressLocation: {
        Notification: 15,
        Window: 10,
    },
    StatusBarAlignment: {
        Left: 1,
    },
    ThemeColor: class {
        constructor(id) {
            this.id = id;
        }
    },
    window: {
        createOutputChannel,
        createStatusBarItem,
        createTreeView,
        registerUriHandler,
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
    },
    workspace: {
        getConfiguration,
    },
}), { virtual: true });

let extensionModule;

beforeAll(async () => {
    extensionModule = await import('../src/extension.js');
});

beforeEach(() => {
    subscriptions.length = 0;
    registeredCommands.length = 0;
    createdTreeViews.length = 0;
    createOutputChannel.mockClear();
    registerCommand.mockClear();
    executeCommand.mockClear();
    createTreeView.mockClear();
    registerUriHandler.mockClear();
    createStatusBarItem.mockClear();
    getConfiguration.mockClear();
});

describe('contest extension activation', () => {
    it('creates the contest output channel and tree view, then registers contest commands', async () => {
        const context = { subscriptions };

        await extensionModule.activate(context);

        // The views show "Loading the contest…" until the first restore settles.
        expect(executeCommand).toHaveBeenCalledWith('setContext', 'autojudgeContest.state', 'loading');
        expect(executeCommand).not.toHaveBeenCalledWith('setContext', 'autojudgeContest.state', 'loggedOut');
        expect(executeCommand.mock.invocationCallOrder[0]).toBeLessThan(createTreeView.mock.invocationCallOrder[0]);
        expect(createOutputChannel).toHaveBeenCalledWith('AutoJudge Contest', { log: true });
        expect(createStatusBarItem).toHaveBeenCalledTimes(1);
        expect(createdTreeViews).toEqual([
            expect.objectContaining({
                viewId: 'autojudgeContest.explorer',
                options: expect.objectContaining({
                    showCollapseAll: true,
                    treeDataProvider: expect.any(Object),
                }),
            }),
            expect.objectContaining({
                viewId: 'autojudgeContest.teams',
                options: expect.objectContaining({
                    showCollapseAll: false,
                    treeDataProvider: expect.any(Object),
                }),
            }),
        ]);
        expect(registeredCommands.map(({ command }) => command)).toEqual([
            'autojudgeContest.loginTeam',
            'autojudgeContest.logoutTeam',
            'autojudgeContest.refreshTree',
            'autojudgeContest.openContestDashboard',
            'autojudgeContest.openProblem',
            'autojudgeContest.submitActiveFile',
            'autojudgeContest.exportPublicCases',
            'autojudgeContest.openSubmission',
            'autojudgeContest.openTeamStanding',
            'autojudgeContest.openStandings',
            'autojudgeContest.compareSubmissionOutput',
            'autojudgeContest.showUnsolvedProblems',
            'autojudgeContest.showAllProblems',
        ]);
        expect(registerUriHandler).toHaveBeenCalledTimes(1);
        expect(registerUriHandler).toHaveBeenCalledWith({ handleUri: expect.any(Function) });
        // output channel, tree provider, two views, status bar, controller, browser login, URI handler, 13 commands
        expect(context.subscriptions).toHaveLength(21);
    });

    it('still activates when autojudgeContest.baseUrl is empty or invalid', async () => {
        getConfiguration.mockImplementation(() => ({
            get: (key, fallbackValue) => (key === 'baseUrl' ? '' : fallbackValue),
        }));
        vi.resetModules();

        try {
            const freshExtension = await import('../src/extension.js');
            const context = { subscriptions: [] };

            await expect(freshExtension.activate(context)).resolves.not.toThrow();
            expect(registeredCommands.map(({ command }) => command)).toContain('autojudgeContest.loginTeam');
        }
        finally {
            getConfiguration.mockImplementation(() => ({
                get: (_key, fallbackValue) => fallbackValue,
            }));
        }
    });

    it('exports a deactivate function', () => {
        expect(typeof extensionModule.deactivate).toBe('function');
    });
});

describe('contest manifest contract', () => {
    it('declares the sidebar container, contest view, and contest settings', async () => {
        const packagePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
            'package.json',
        );
        const manifest = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(packagePath, 'utf8')));

        expect(manifest.name).toBe('autojudge-contest');
        expect(manifest.main).toBe('./src/extension.js');
        expect(manifest.contributes.viewsContainers.activitybar).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'autojudgeContest',
                title: 'AutoJudge Contest',
            }),
        ]));
        expect(manifest.contributes.views.autojudgeContest).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'autojudgeContest.explorer',
                name: 'Contest Explorer',
            }),
            expect.objectContaining({
                id: 'autojudgeContest.teams',
                name: 'Standings',
            }),
        ]));
        expect(manifest.contributes.viewsWelcome).toEqual(expect.arrayContaining([
            expect.objectContaining({
                contents: expect.stringContaining('autojudgeContest.loginTeam'),
                view: 'autojudgeContest.explorer',
            }),
            expect.objectContaining({
                contents: expect.stringContaining('autojudgeContest.loginTeam'),
                view: 'autojudgeContest.teams',
            }),
        ]));
        expect(manifest.contributes.commands.map(command => command.command)).toEqual(expect.arrayContaining([
            'autojudgeContest.loginTeam',
            'autojudgeContest.logoutTeam',
            'autojudgeContest.refreshTree',
            'autojudgeContest.openProblem',
            'autojudgeContest.submitActiveFile',
            'autojudgeContest.exportPublicCases',
            'autojudgeContest.openSubmission',
            'autojudgeContest.openTeamStanding',
            'autojudgeContest.openStandings',
            'autojudgeContest.compareSubmissionOutput',
            'autojudgeContest.showUnsolvedProblems',
            'autojudgeContest.showAllProblems',
        ]));
        expect(manifest.contributes.commands.every(command => command.category === 'AutoJudge Contest' && !command.title.startsWith('AutoJudge Contest:'))).toBe(true);
        expect(manifest.contributes.commands.map(command => command.command)).not.toContain('autojudgeContest.createTestCases');
        expect(manifest.contributes.menus['view/item/context']).toEqual(expect.arrayContaining([
            expect.objectContaining({
                command: 'autojudgeContest.openProblem',
                when: expect.stringContaining('viewItem == autojudgeContest.problem'),
            }),
        ]));
        // Submission rows open on click; the menu only adds the explicit open and compare actions.
        expect(manifest.contributes.menus['view/item/context']).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                command: 'autojudgeContest.openSubmission',
                group: expect.stringMatching(/^inline/),
            }),
        ]));
        // Logout lives in the overflow menu, never as a toolbar icon next to refresh.
        expect(manifest.contributes.menus['view/title']).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                command: 'autojudgeContest.logoutTeam',
                group: expect.stringMatching(/^navigation/),
            }),
        ]));
        // The explorer filter is one toolbar button that swaps on the context key.
        const filterButtons = manifest.contributes.menus['view/title']
            .filter(item => /^autojudgeContest\.show(Unsolved|All)Problems$/.test(item.command));
        expect(filterButtons).toEqual([
            expect.objectContaining({ command: 'autojudgeContest.showUnsolvedProblems', when: expect.stringContaining('!autojudgeContest.unsolvedOnly') }),
            expect.objectContaining({ command: 'autojudgeContest.showAllProblems', when: expect.stringMatching(/&& autojudgeContest\.unsolvedOnly$/) }),
        ]);
        expect(filterButtons.every(item => item.when.includes('view == autojudgeContest.explorer') && item.group.startsWith('navigation'))).toBe(true);
        expect(manifest.contributes.configuration.properties).toEqual(expect.objectContaining({
            'autojudgeContest.baseUrl': expect.objectContaining({ scope: 'application' }),
            'autojudgeContest.pollIntervalMs': expect.any(Object),
            'autojudgeContest.webUrl': expect.objectContaining({ default: 'https://autojudge.io', scope: 'application' }),
        }));
    });

    it('activates on the login callback and on every contributed command and view', async () => {
        const packagePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
            'package.json',
        );
        const manifest = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(packagePath, 'utf8')));

        expect(manifest.activationEvents).toContain('onUri');
        expect(manifest.activationEvents).toEqual(expect.arrayContaining([
            ...manifest.contributes.commands.map(command => `onCommand:${command.command}`),
            ...manifest.contributes.views.autojudgeContest.map(view => `onView:${view.id}`),
        ]));
    });
});