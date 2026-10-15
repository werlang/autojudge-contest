import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key, fallbackValue) => fallbackValue,
        }),
    },
}), { virtual: true });

import { createContestController, logToChannel } from '../src/controllers/contest-controller.js';
import { BrowserLoginError, LOGIN_FAILURE } from '../src/services/browser-login.js';

const ROOT = '/workspace/.autojudge-state';

/**
 * Let pending promise callbacks (non-awaited toasts and their actions) run.
 * @param {number} [turns]
 */
async function flushPromises(turns = 10) {
    for (let index = 0; index < turns; index += 1) {
        await Promise.resolve();
    }
}

/**
 * Build a snapshot with the only shape the server sends: publicId on contests
 * and problems, solvedProblemIds and publicId on teams, and no numeric ids.
 * @returns {object}
 */
function createSnapshot() {
    const problems = [
        { publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B', input: ['1 2\n'], output: ['3\n'] },
        { publicId: 'pb2c3d4e5f6a1', order: 2, title: 'Binary Search' },
    ];
    const contest = {
        duration: 180,
        name: 'Regional Final',
        penaltyTime: 20,
        problems,
        publicId: 'k3m9x2p7q8w1a',
        startTime: '2026-05-28T03:00:00.000Z',
        teams: [
            {
                name: 'Array Ninjas',
                publicId: 'tninjas7f3a00',
                score: 350000,
                solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
            },
            {
                name: 'Bits',
                publicId: 'tbits91cd0000',
                score: 200000,
                solvedProblemIds: ['pa1b2c3d4e5f6'],
            },
        ],
    };

    return {
        problems: [problems[0]],
        submissions: [],
        team: {
            contest,
            name: 'Bits',
            publicId: 'tbits91cd0000',
        },
        contest,
        token: 'team-jwt-token',
    };
}

/**
 * Build a snapshot that lists both contest problems.
 * @returns {object}
 */
function createFullSnapshot() {
    const snapshot = createSnapshot();
    return { ...snapshot, problems: snapshot.contest.problems };
}

/**
 * Build an API-style error as the contest API client throws it.
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function apiError(statusCode, code, message) {
    return Object.assign(new Error(message), { code, statusCode });
}

/**
 * Build a fake tree view whose visibility can be toggled from the test.
 * @param {boolean} visible
 * @returns {{ visible: boolean, onDidChangeVisibility: Function, setVisible: (value: boolean) => void }}
 */
function createFakeView(visible) {
    const listeners = new Set();
    return {
        visible,
        onDidChangeVisibility(listener) {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        setVisible(value) {
            this.visible = value;
            for (const listener of listeners) {
                listener({ visible: value });
            }
        },
    };
}

/**
 * Build a fake vscode.Uri for a file path.
 * @param {string} fsPath
 * @returns {{ scheme: string, fsPath: string }}
 */
function fileUri(fsPath) {
    return { scheme: 'file', fsPath };
}

describe('contest controller', () => {
    let context;
    let workspaceStateStore;
    let outputChannel;
    let openTextDocument;
    let showTextDocument;
    let browserLogin;
    let showWarningMessage;
    let showQuickPick;
    let withCancellableProgress;
    let withExplorerProgress;
    let resolvePollIntervalMs;
    let resolveBaseUrl;
    let resolveConfirmBeforeSubmit;
    let sessionApi;
    let executeCommand;
    let setContext;
    let showInformationMessage;
    let showErrorMessage;
    let submissionWorkspace;
    let teamsStandingsProvider;
    let treeProvider;
    let statusBar;
    let pageFiles;
    let controllers;
    let clock;

    beforeEach(() => {
        workspaceStateStore = {};
        context = {
            id: 'extension-context',
            storageUri: { fsPath: ROOT },
            workspaceState: {
                get: (key) => workspaceStateStore[key],
                update: vi.fn(async (key, value) => {
                    workspaceStateStore[key] = value;
                }),
            },
        };
        outputChannel = {
            appendLine: vi.fn(),
            clear: vi.fn(),
            show: vi.fn(),
        };
        // Fake page-file writer: the real one is covered in contest-page-files.test.js.
        pageFiles = {
            writePage: vi.fn(async (folder, pageName, fallbackName) => `${ROOT}/${folder}/${pageName || fallbackName}.md`),
            writeComparison: vi.fn(async (id) => ({
                expectedPath: `${ROOT}/submission-output/${id}/expected.txt`,
                receivedPath: `${ROOT}/submission-output/${id}/received.txt`,
            })),
        };
        openTextDocument = vi.fn(async (target) => ({ uri: `uri:${target?.fsPath ?? target}` }));
        showTextDocument = vi.fn();
        browserLogin = { waitForHandoffCode: vi.fn() };
        showWarningMessage = vi.fn();
        showQuickPick = vi.fn();
        withCancellableProgress = vi.fn(async (_title, task) => await task({ onCancellationRequested: vi.fn() }));
        withExplorerProgress = vi.fn(async (task) => await task());
        resolvePollIntervalMs = vi.fn(() => 1500);
        resolveBaseUrl = vi.fn(() => 'https://api.autojudge.test');
        resolveConfirmBeforeSubmit = vi.fn(() => true);
        sessionApi = {
            clearStoredSession: vi.fn(),
            readStoredSession: vi.fn(async () => ({ token: 'stored-token' })),
            redeemAndLoadContest: vi.fn(),
            pollSubmissionResults: vi.fn(),
            refreshContestDetails: vi.fn(),
            restoreContestSession: vi.fn(),
            submitSolution: vi.fn(),
        };
        executeCommand = vi.fn();
        setContext = vi.fn();
        showInformationMessage = vi.fn();
        showErrorMessage = vi.fn();
        submissionWorkspace = {
            exportPublicCases: vi.fn(),
            findExistingCaseFiles: vi.fn(async () => []),
            pickExportDirectory: vi.fn(async () => fileUri('/workspace/cases')),
            readActiveSourceFile: vi.fn(async () => ({
                filename: 'main.cpp',
                sourceCode: 'int main() { return 0; }\n',
                uri: fileUri('/workspace/main.cpp'),
                isDirty: false,
            })),
            readSourceDocument: vi.fn((document) => ({
                filename: 'main.cpp',
                sourceCode: document.getText() || ' ',
                uri: fileUri('/workspace/main.cpp'),
                document,
                isDirty: false,
            })),
        };
        teamsStandingsProvider = { setSnapshot: vi.fn() };
        treeProvider = {
            getSnapshot: vi.fn(() => null),
            refresh: vi.fn(),
            setSnapshot: vi.fn(),
        };
        statusBar = { update: vi.fn(), setPendingCount: vi.fn() };
        controllers = [];
        clock = Date.parse('2026-05-28T04:00:00.000Z');
        // The shared poll loop runs until it is stopped unless a test says otherwise.
        pollHangs();
    });

    afterEach(() => {
        for (const controller of controllers) {
            controller.dispose();
        }
        vi.useRealTimers();
    });

    /**
     * Make the shared poll loop run until it is aborted.
     */
    function pollHangs() {
        sessionApi.pollSubmissionResults.mockImplementation(({ signal }) => new Promise((resolve) => {
            signal.addEventListener('abort', resolve, { once: true });
        }));
    }

    /**
     * Make the shared poll loop deliver these final verdicts, then end.
     * @param {...object} finals
     */
    function pollResolves(...finals) {
        sessionApi.pollSubmissionResults.mockImplementation(async ({ tracker }) => {
            tracker.ids();
            for (const final of finals) {
                await tracker.resolve(final);
            }
        });
    }

    /**
     * Make the shared poll loop reach the poll timeout without a verdict.
     */
    function pollTimesOut() {
        sessionApi.pollSubmissionResults.mockImplementation(async ({ tracker }) => {
            clock += 120000;
            tracker.ids();
        });
    }

    /**
     * Read the submission ids the given poll loop call is tracking.
     * @param {number} [call]
     * @returns {string[]}
     */
    function trackedIds(call = 0) {
        return sessionApi.pollSubmissionResults.mock.calls[call][0].tracker.ids();
    }

    /**
     * Build a controller with the shared doubles and optional overrides.
     * @param {object} [overrides]
     * @returns {ReturnType<typeof createContestController>}
     */
    function buildController(overrides = {}) {
        const controller = createContestController({
            browserLogin,
            context,
            executeCommand,
            openTextDocument,
            showTextDocument,
            outputChannel,
            pageFiles,
            resolvePollIntervalMs,
            resolveBaseUrl,
            resolveConfirmBeforeSubmit,
            sessionApi,
            setContext,
            showInformationMessage,
            showErrorMessage,
            showWarningMessage,
            showQuickPick,
            statusBar,
            submissionWorkspace,
            teamsStandingsProvider,
            toFileUri: (fsPath) => fileUri(fsPath),
            treeProvider,
            withCancellableProgress,
            withExplorerProgress,
            now: () => clock,
            ...overrides,
        });
        controllers.push(controller);
        return controller;
    }

    /**
     * Build a controller that starts logged in with the given snapshot.
     * @param {object} snapshot
     * @param {object} [overrides]
     * @returns {ReturnType<typeof createContestController>}
     */
    function buildLoggedInController(snapshot, overrides = {}) {
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        return buildController(overrides);
    }

    /**
     * Collect the page paths written through the fake page-file writer.
     * @returns {string[]}
     */
    function writtenPaths() {
        return pageFiles.writePage.mock.calls.map(([folder, pageName]) => `${ROOT}/${folder}/${pageName}.md`);
    }

    /**
     * Read the content of a written page.
     * @param {number} [index] call index, last by default
     * @returns {string}
     */
    function pageContent(index = -1) {
        return pageFiles.writePage.mock.calls.at(index)[3];
    }

    describe('login and session', () => {
        it('logs in through the browser hand-off and pushes the snapshot into the trees and status bar', async () => {
            const snapshot = createSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(snapshot);

            const result = await buildController().loginTeam();

            expect(withCancellableProgress).toHaveBeenCalledWith('Complete the login in your browser…', expect.any(Function));
            expect(sessionApi.redeemAndLoadContest).toHaveBeenCalledWith({
                baseUrl: 'https://api.autojudge.test',
                code: 'handoff-code',
                context,
                isCurrent: expect.any(Function),
            });
            // The only login in flight is the current one, so its token may be stored.
            expect(sessionApi.redeemAndLoadContest.mock.calls[0][0].isCurrent()).toBe(true);
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
            expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
            expect(statusBar.update).toHaveBeenCalledWith(snapshot);
            expect(statusBar.setPendingCount).toHaveBeenLastCalledWith(0);
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedIn');
            expect(outputChannel.appendLine).toHaveBeenCalledWith('Logged in as Bits for Regional Final.');
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(result).toEqual(snapshot);
        });

        it('does not crash when the team or contest name is missing', async () => {
            const snapshot = { ...createSnapshot(), team: { publicId: 'tbits91cd0000' }, contest: { publicId: 'k3m9x2p7q8w1a' } };
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(snapshot);

            await expect(buildController().loginTeam()).resolves.toEqual(snapshot);
            expect(outputChannel.appendLine).toHaveBeenCalledWith('Logged in as your team for the contest.');
        });

        it('hands the cancellation token of the progress notification to the browser login', async () => {
            const cancellation = { onCancellationRequested: vi.fn() };
            withCancellableProgress.mockImplementation(async (_title, task) => await task(cancellation));
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(createSnapshot());

            await buildController().loginTeam();

            expect(browserLogin.waitForHandoffCode).toHaveBeenCalledWith(cancellation);
        });

        it('rejects an invalid base URL setting before opening the browser', async () => {
            const invalid = Object.assign(new Error('The autojudgeContest.baseUrl setting is not a valid http(s) URL. Fix it in Settings.'), {
                code: 'INVALID_SETTING',
                setting: 'autojudgeContest.baseUrl',
            });
            resolveBaseUrl.mockImplementation(() => {
                throw invalid;
            });

            const result = await buildController().loginTeam();

            expect(result).toBeNull();
            expect(withCancellableProgress).not.toHaveBeenCalled();
            expect(browserLogin.waitForHandoffCode).not.toHaveBeenCalled();
            expect(showErrorMessage).toHaveBeenCalledWith(invalid.message, 'Open Settings');
        });

        it('ends quietly when the user cancels the browser login', async () => {
            browserLogin.waitForHandoffCode.mockRejectedValue(new BrowserLoginError(LOGIN_FAILURE.CANCELLED, 'Login cancelled.'));

            const result = await buildController().loginTeam();

            expect(result).toBeNull();
            expect(sessionApi.redeemAndLoadContest).not.toHaveBeenCalled();
            expect(showErrorMessage).not.toHaveBeenCalled();
        });

        it('reports a browser login that timed out without an ERROR prefix', async () => {
            browserLogin.waitForHandoffCode.mockRejectedValue(new BrowserLoginError(LOGIN_FAILURE.TIMEOUT, 'The browser login timed out. Run Log In again.'));

            const result = await buildController().loginTeam();

            expect(result).toBeNull();
            expect(showErrorMessage).toHaveBeenCalledWith('The browser login timed out. Run Log In again.');
            expect(outputChannel.appendLine).toHaveBeenCalledWith('The browser login timed out. Run Log In again.');
            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
        });

        it('explains an expired or reused hand-off code without clearing the stored session', async () => {
            browserLogin.waitForHandoffCode.mockResolvedValue('used-code');
            sessionApi.redeemAndLoadContest.mockRejectedValue(apiError(400, 'HANDOFF_INVALID', 'This sign-in link is invalid or has expired.'));

            const result = await buildController().loginTeam();

            expect(result).toBeNull();
            expect(showErrorMessage).toHaveBeenCalledWith('The browser login link expired or was already used. Run Log In again.');
            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
            expect(showWarningMessage).not.toHaveBeenCalled();
        });

        it('clears the token and offers a Log In action when restoring a session finds it ended', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'Your team session has ended. Log in again.'));
            showWarningMessage.mockResolvedValue(undefined);

            const result = await buildController().refreshTree();
            await flushPromises();

            expect(result).toBeNull();
            expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(null);
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedOut');
            expect(showWarningMessage).toHaveBeenCalledWith(
                'Your session ended. Log in again (ask staff to reset your PIN if needed).',
                'Log In',
            );
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(browserLogin.waitForHandoffCode).not.toHaveBeenCalled();
        });

        it('starts the browser login when the Log In action of the session-ended message is chosen', async () => {
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'ended'));
            showWarningMessage.mockImplementation(async (message) => (message.startsWith('Submit') ? 'Submit' : 'Log In'));
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(snapshot);

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);
            await flushPromises();

            expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
            expect(browserLogin.waitForHandoffCode).toHaveBeenCalledTimes(1);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(snapshot);
        });

        it('shows the session-ended prompt again after the user starts a new login', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'ended'));
            const controller = buildController();

            await controller.refreshTree();
            await flushPromises();
            expect(showWarningMessage).toHaveBeenCalledTimes(1);

            browserLogin.waitForHandoffCode.mockRejectedValue(new BrowserLoginError(LOGIN_FAILURE.CANCELLED, 'Login cancelled.'));
            await controller.loginTeam();

            await controller.refreshTree();
            await flushPromises();
            expect(showWarningMessage).toHaveBeenCalledTimes(2);
        });

        it('shows the session-ended message once when several requests notice it together', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'ended'));
            const controller = buildController();

            await Promise.all([controller.refreshTree(), controller.refreshTree()]);

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
        });

        it('logs out by clearing storage and resetting the trees and status bar', async () => {
            await buildLoggedInController(createSnapshot()).logoutTeam();

            expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(null);
            expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(null);
            expect(statusBar.update).toHaveBeenLastCalledWith(null);
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedOut');
        });
    });

    describe('refresh and view states', () => {
        it('restores a saved session on refresh and shows explorer progress for a manual refresh', async () => {
            const snapshot = createSnapshot();
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);

            const result = await buildController().refreshTree();

            expect(withExplorerProgress).toHaveBeenCalledTimes(1);
            expect(sessionApi.restoreContestSession).toHaveBeenCalledWith({
                baseUrl: 'https://api.autojudge.test',
                context,
            });
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedIn');
            expect(result).toEqual(snapshot);
        });

        it('switches to logged out when no token is stored on the silent startup restore', async () => {
            sessionApi.restoreContestSession.mockResolvedValue(null);

            await buildController().refreshTree({ silent: true });

            expect(withExplorerProgress).not.toHaveBeenCalled();
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedOut');
            expect(showErrorMessage).not.toHaveBeenCalled();
        });

        it('goes offline without a toast when the silent startup restore fails with a stored token', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(new Error('fetch failed'));

            const result = await buildController().refreshTree({ silent: true });
            await flushPromises();

            expect(result).toBeNull();
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'offline');
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(null);
            expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(null);
            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
            expect(outputChannel.appendLine).toHaveBeenCalledWith('Could not load the contest: fetch failed');
            expect(showErrorMessage).not.toHaveBeenCalled();
        });

        it('goes offline and shows an error toast when a manual refresh fails', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(apiError(401, 'UNAUTHORIZED', 'Not allowed.'));

            await buildController().refreshTree();
            await flushPromises();

            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'offline');
            expect(showErrorMessage).toHaveBeenCalledWith('Not allowed.');
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
        });

        it('keeps the shown contest and its verdict polls when a manual refresh fails while logged in', async () => {
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValueOnce(snapshot).mockRejectedValue(new Error('fetch failed'));
            const controller = buildController();
            await controller.refreshTree({ silent: true });
            const { signal } = sessionApi.pollSubmissionResults.mock.calls[0][0];
            treeProvider.setSnapshot.mockClear();
            setContext.mockClear();

            const result = await controller.refreshTree();
            await flushPromises();

            expect(result).toBeNull();
            expect(treeProvider.setSnapshot).not.toHaveBeenCalled();
            expect(setContext).not.toHaveBeenCalled();
            expect(signal.aborted).toBe(false);
            expect(showErrorMessage).toHaveBeenCalledWith('fetch failed');
            expect(outputChannel.appendLine).toHaveBeenCalledWith('Could not load the contest: fetch failed');
        });

        it('shows logged out instead of offline when a failed refresh has no stored token', async () => {
            sessionApi.restoreContestSession.mockRejectedValue(new Error('fetch failed'));
            sessionApi.readStoredSession.mockResolvedValue(null);

            await buildController().refreshTree();

            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedOut');
            expect(setContext).not.toHaveBeenCalledWith('autojudgeContest.state', 'offline');
        });

        it('offers Open Settings for an invalid setting and opens that setting when chosen', async () => {
            const invalid = Object.assign(new Error('The autojudgeContest.baseUrl setting is not a valid http(s) URL. Fix it in Settings.'), {
                code: 'INVALID_SETTING',
                setting: 'autojudgeContest.baseUrl',
            });
            resolveBaseUrl.mockImplementation(() => {
                throw invalid;
            });
            showErrorMessage.mockResolvedValue('Open Settings');

            await buildController().refreshTree();
            await flushPromises();

            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'offline');
            expect(showErrorMessage).toHaveBeenCalledWith(invalid.message, 'Open Settings');
            expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'autojudgeContest.baseUrl');
        });

        it('keeps the session and reports a contest that has not started yet on refresh', async () => {
            const snapshot = { ...createSnapshot(), problems: [], contestNotStarted: true };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);

            const result = await buildController().refreshTree();

            expect(result).toEqual(snapshot);
            expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedIn');
            expect(outputChannel.appendLine).toHaveBeenCalledWith('The contest has not started yet. The problems load automatically once it starts.');
            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
            expect(showErrorMessage).not.toHaveBeenCalled();
        });
    });

    describe('generated pages', () => {
        it('names the problem page after its letter and title so the tab reads "Preview A. A + B.md"', async () => {
            const snapshot = createFullSnapshot();
            openTextDocument.mockResolvedValue({ uri: 'problem-uri' });

            await buildLoggedInController(snapshot).openProblem({ ...snapshot.problems[0], description: 'Add two integers.' });

            expect(pageFiles.writePage).toHaveBeenCalledWith(
                'problem-previews',
                'A. A + B',
                'problem-pa1b2c3d4e5f6',
                expect.stringContaining('# A. A + B'),
            );
            expect(pageContent()).toContain('Add two integers.');
            expect(openTextDocument).toHaveBeenCalledWith(`${ROOT}/problem-previews/A. A + B.md`);
            expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', 'problem-uri', { preview: true });
        });

        it('accepts a tree item that wraps the problem', async () => {
            const snapshot = createFullSnapshot();

            await buildLoggedInController(snapshot).openProblem({ problem: snapshot.problems[1] });

            expect(writtenPaths()).toEqual([`${ROOT}/problem-previews/B. Binary Search.md`]);
        });

        it('opens the contest overview page named after the contest', async () => {
            const contest = {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
                duration: 180,
                startTime: '2026-05-28T03:00:00.000Z',
            };

            const result = await buildController().openContestDashboard(contest);

            expect(writtenPaths()).toEqual([`${ROOT}/contest-dashboards/Contest Overview · Regional Final.md`]);
            expect(pageContent()).toContain('# Contest Overview · Regional Final');
            expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', expect.anything(), { preview: true });
            expect(result).toEqual(contest);
        });

        it('shows Not started in the contest overview when the contest has no start time', async () => {
            await buildController().openContestDashboard({
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
                duration: 180,
                startTime: null,
                penaltyTime: 20,
                freezeTime: 60,
                teams: [],
                problems: [],
            });

            const dashboard = pageContent();
            expect(dashboard).toContain('- **Start:** Not started');
            expect(dashboard).toContain('- **End:** Not started');
            expect(dashboard).not.toContain('1970');
        });

        it('opens the submission page named "Submission 12 · A. A + B"', async () => {
            const snapshot = createFullSnapshot();
            const submission = {
                id: 12,
                problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                status: 'ACCEPTED',
                submittedAt: '2026-05-28T03:10:00.000Z',
            };

            const result = await buildLoggedInController(snapshot).openSubmission({ submission });

            expect(writtenPaths()).toEqual([`${ROOT}/submission-details/Submission 12 · A. A + B.md`]);
            expect(pageContent()).toContain('# Submission 12');
            expect(result).toEqual(submission);
        });

        it('opens the team page named after the team with its rank from the current standings', async () => {
            const snapshot = createSnapshot();
            const controller = buildLoggedInController(snapshot);

            await controller.openTeamStanding(snapshot.contest.teams[1]);

            expect(writtenPaths()).toEqual([`${ROOT}/team-details/Bits.md`]);
            const content = pageContent(0);
            expect(content).toContain('- **Rank:** #2 of 2');
            expect(content).toContain('- **Solved:** 1 of 2');
            expect(content).toContain('- A. A + B');
        });
    });

    describe('palette fallbacks', () => {
        it('asks which problem to open when the palette passes no argument', async () => {
            const snapshot = createFullSnapshot();
            snapshot.submissions = [
                { id: 1, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' }, submittedAt: '2026-05-28T03:10:00.000Z' },
                { id: 2, status: 'WRONG_ANSWER', problem: { publicId: 'pb2c3d4e5f6a1' }, submittedAt: '2026-05-28T03:11:00.000Z' },
            ];
            showQuickPick.mockImplementation(async (items) => items[1]);

            await buildLoggedInController(snapshot).openProblem();

            expect(showQuickPick).toHaveBeenCalledWith([
                expect.objectContaining({ label: 'A. A + B', description: '✓ Solved' }),
                expect.objectContaining({ label: 'B. Binary Search', description: '1 attempt' }),
            ], expect.objectContaining({ placeHolder: 'Open which problem?' }));
            expect(writtenPaths()).toEqual([`${ROOT}/problem-previews/B. Binary Search.md`]);
        });

        it('does nothing when the problem quick pick is cancelled', async () => {
            showQuickPick.mockResolvedValue(undefined);

            const result = await buildLoggedInController(createFullSnapshot()).exportPublicCases();

            expect(result).toBeNull();
            expect(showQuickPick).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
                placeHolder: 'Export test cases for which problem?',
            }));
            expect(submissionWorkspace.pickExportDirectory).not.toHaveBeenCalled();
        });

        it('renders the overview from the current snapshot rather than a stale tree item contest', async () => {
            const snapshot = createSnapshot();
            snapshot.contest = { ...snapshot.contest, name: 'Regional Final', duration: 240 };
            const staleTreeContest = { ...snapshot.contest, duration: 180, name: 'Old Name' };

            const result = await buildLoggedInController(snapshot).openContestDashboard({ contest: staleTreeContest });

            expect(result).toBe(snapshot.contest);
            expect(writtenPaths()).toEqual([`${ROOT}/contest-dashboards/Contest Overview · Regional Final.md`]);
        });

        it('opens the current contest overview when the palette passes no contest', async () => {
            const snapshot = createSnapshot();

            const result = await buildLoggedInController(snapshot).openContestDashboard();

            expect(result).toBe(snapshot.contest);
            expect(writtenPaths()).toEqual([`${ROOT}/contest-dashboards/Contest Overview · Regional Final.md`]);
        });

        it('asks to log in first, with a Log In action, when logged out', async () => {
            showErrorMessage.mockResolvedValue('Log In');
            browserLogin.waitForHandoffCode.mockRejectedValue(new BrowserLoginError(LOGIN_FAILURE.CANCELLED, 'Login cancelled.'));

            const controller = buildController();
            await controller.openProblem();
            await controller.openContestDashboard();
            await controller.submitActiveFile();
            await flushPromises();

            expect(showErrorMessage).toHaveBeenCalledTimes(3);
            expect(showErrorMessage).toHaveBeenCalledWith('Log in to AutoJudge Contest first.', 'Log In');
            expect(showQuickPick).not.toHaveBeenCalled();
            expect(browserLogin.waitForHandoffCode).toHaveBeenCalled();
        });
    });

    describe('submit', () => {
        const pending = (id = 27) => ({
            id,
            problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        });

        beforeEach(() => {
            showWarningMessage.mockImplementation(async (message) => (message.startsWith('Submit ') ? 'Submit' : undefined));
            pollTimesOut();
        });

        it('confirms, submits the tree item problem, merges the pending submission, and remembers the problem', async () => {
            const snapshot = createSnapshot();
            const created = pending();
            sessionApi.submitSolution.mockResolvedValue(created);

            const result = await buildLoggedInController(snapshot).submitActiveFile({ problem: snapshot.problems[0] });

            expect(showWarningMessage).toHaveBeenCalledWith(
                'Submit main.cpp to A. A + B?',
                { modal: true, detail: 'If it is rejected and you solve the problem later, it adds 20 min of penalty.' },
                'Submit',
            );
            expect(sessionApi.submitSolution).toHaveBeenCalledWith({
                baseUrl: 'https://api.autojudge.test',
                code: Buffer.from('int main() { return 0; }\n', 'utf-8').toString('base64'),
                context,
                filename: 'main.cpp',
                problemId: 'pa1b2c3d4e5f6',
            });
            expect(treeProvider.setSnapshot).toHaveBeenCalledWith({ ...snapshot, submissions: [created] });
            expect(statusBar.setPendingCount).toHaveBeenCalledWith(1);
            expect(workspaceStateStore['autojudgeContest.lastProblemByFile']).toEqual({ '/workspace/main.cpp': 'pa1b2c3d4e5f6' });
            expect(outputChannel.show).not.toHaveBeenCalled();
            expect(showInformationMessage).not.toHaveBeenCalled();
            expect(result).toEqual(created);
        });

        it('uses a generic penalty sentence when the contest penalty is unknown', async () => {
            const snapshot = createSnapshot();
            snapshot.contest = { ...snapshot.contest, penaltyTime: undefined };
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(showWarningMessage).toHaveBeenCalledWith(
                'Submit main.cpp to A. A + B?',
                { modal: true, detail: 'A rejected attempt adds penalty time if you solve the problem later.' },
                'Submit',
            );
        });

        it('does not submit to a problem the team already solved', async () => {
            const snapshot = createSnapshot();
            snapshot.submissions = [
                { id: 3, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' }, submittedAt: '2026-05-28T03:10:00.000Z' },
            ];

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(result).toBeNull();
            expect(showInformationMessage).toHaveBeenCalledWith('A. A + B is already solved.');
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(sessionApi.submitSolution).not.toHaveBeenCalled();
        });

        it('does not submit when the confirmation is cancelled', async () => {
            showWarningMessage.mockResolvedValue(undefined);
            const snapshot = createSnapshot();

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(result).toBeNull();
            expect(sessionApi.submitSolution).not.toHaveBeenCalled();
        });

        it('skips the confirmation when confirmBeforeSubmit is off', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(1);
        });

        it('refuses a second submit while the first is still being sent, then allows it again', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const snapshot = createSnapshot();
            let resolveFirst;
            sessionApi.submitSolution
                .mockReturnValueOnce(new Promise((resolve) => {
                    resolveFirst = resolve;
                }))
                .mockResolvedValue(pending(28));
            const controller = buildLoggedInController(snapshot);

            const first = controller.submitActiveFile(snapshot.problems[0]);
            const second = await controller.submitActiveFile(snapshot.problems[0]);

            expect(second).toBeNull();
            expect(showInformationMessage).toHaveBeenCalledWith('A submission is already being sent. Wait for it to finish.');

            resolveFirst(pending(27));
            await first;
            await controller.submitActiveFile(snapshot.problems[0]);

            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(2);
        });

        it('releases the submit guard after a failed upload so the next submit proceeds', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockRejectedValueOnce(new Error('Bad gateway.')).mockResolvedValue(pending(28));
            const controller = buildLoggedInController(snapshot);

            await expect(controller.submitActiveFile(snapshot.problems[0])).resolves.toBeNull();
            await controller.submitActiveFile(snapshot.problems[0]);

            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(2);
            expect(showInformationMessage).not.toHaveBeenCalledWith('A submission is already being sent. Wait for it to finish.');
        });

        it('releases the submit guard after the confirmation is cancelled so the next submit proceeds', async () => {
            const snapshot = createSnapshot();
            showWarningMessage.mockResolvedValueOnce(undefined).mockResolvedValue('Submit');
            sessionApi.submitSolution.mockResolvedValue(pending());
            const controller = buildLoggedInController(snapshot);

            await expect(controller.submitActiveFile(snapshot.problems[0])).resolves.toBeNull();
            await controller.submitActiveFile(snapshot.problems[0]);

            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(1);
            expect(showInformationMessage).not.toHaveBeenCalledWith('A submission is already being sent. Wait for it to finish.');
        });

        it('allows another submit while the previous verdict is still being polled', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockResolvedValueOnce(pending(27)).mockResolvedValueOnce(pending(28));
            pollHangs();
            const controller = buildLoggedInController(snapshot);

            void controller.submitActiveFile(snapshot.problems[0]);
            await flushPromises(30);
            void controller.submitActiveFile(snapshot.problems[0]);
            await flushPromises(30);

            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(2);
            expect(showInformationMessage).not.toHaveBeenCalled();
        });

        it('asks which problem from the palette and preselects the one last submitted from this file', async () => {
            const snapshot = createFullSnapshot();
            workspaceStateStore['autojudgeContest.lastProblemByFile'] = { '/workspace/main.cpp': 'pb2c3d4e5f6a1' };
            showQuickPick.mockImplementation(async (items) => items[0]);
            sessionApi.submitSolution.mockResolvedValue({ ...pending(), problem: { publicId: 'pb2c3d4e5f6a1' } });

            await buildLoggedInController(snapshot).submitActiveFile();

            const [items, options] = showQuickPick.mock.calls[0];
            expect(options).toEqual(expect.objectContaining({ placeHolder: 'Submit main.cpp to which problem?' }));
            expect(items.map(item => item.label)).toEqual(['B. Binary Search', 'A. A + B']);
            expect(items[0].picked).toBe(true);
            expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({ problemId: 'pb2c3d4e5f6a1' }));
        });

        it('treats an editor-title Uri as "no problem chosen" and opens that file when it is not the active editor', async () => {
            const snapshot = createFullSnapshot();
            const otherFile = fileUri('/workspace/other.py');
            showQuickPick.mockImplementation(async (items) => items[0]);
            sessionApi.submitSolution.mockResolvedValue(pending());
            submissionWorkspace.readActiveSourceFile
                .mockResolvedValueOnce({ filename: 'main.cpp', sourceCode: 'x', uri: fileUri('/workspace/main.cpp'), isDirty: false })
                .mockResolvedValue({ filename: 'other.py', sourceCode: 'print(1)', uri: otherFile, isDirty: false });

            await buildLoggedInController(snapshot).submitActiveFile(otherFile);

            expect(openTextDocument).toHaveBeenCalledWith(otherFile);
            expect(showTextDocument).toHaveBeenCalled();
            expect(showQuickPick).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
                placeHolder: 'Submit other.py to which problem?',
            }));
            expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({ filename: 'other.py' }));
        });

        it('does not reopen the file when the editor-title Uri is already the active editor', async () => {
            showQuickPick.mockImplementation(async (items) => items[0]);
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(createFullSnapshot()).submitActiveFile(fileUri('/workspace/main.cpp'));

            expect(openTextDocument).not.toHaveBeenCalled();
            expect(sessionApi.submitSolution).toHaveBeenCalledTimes(1);
        });

        it('saves a dirty file after the Save and Submit prompt and submits the saved content', async () => {
            const snapshot = createSnapshot();
            let text = 'old content';
            const document = {
                getText: () => text,
                save: vi.fn(async () => {
                    text = 'saved content';
                    return true;
                }),
            };
            submissionWorkspace.readActiveSourceFile.mockResolvedValue({
                filename: 'main.cpp', sourceCode: 'old content', uri: fileUri('/workspace/main.cpp'), document, isDirty: true,
            });
            showWarningMessage.mockResolvedValue('Save and Submit');
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage).toHaveBeenCalledWith(
                'main.cpp has unsaved changes.',
                expect.objectContaining({ modal: true }),
                'Save and Submit',
            );
            expect(document.save).toHaveBeenCalled();
            expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({
                code: Buffer.from('saved content', 'utf-8').toString('base64'),
            }));
        });

        it('submits the re-read file after a save instead of falling back to the pre-save text', async () => {
            const snapshot = createSnapshot();
            let text = 'stale text';
            const document = {
                getText: () => text,
                save: vi.fn(async () => {
                    text = '';
                    return true;
                }),
            };
            submissionWorkspace.readActiveSourceFile.mockResolvedValue({
                filename: 'main.cpp', sourceCode: 'stale text', uri: fileUri('/workspace/main.cpp'), document, isDirty: true,
            });
            showWarningMessage.mockResolvedValue('Save and Submit');
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({
                code: Buffer.from(' ', 'utf-8').toString('base64'),
            }));
        });

        it('warns that a timed-out upload may have been accepted and reloads the submissions', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockRejectedValue(Object.assign(new Error('The AutoJudge server did not respond in time.'), { code: 'REQUEST_TIMEOUT' }));
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(result).toBeNull();
            expect(showErrorMessage).toHaveBeenCalledWith('The upload did not finish in time. Check Contest Explorer before submitting again.');
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(1);
            expect(withExplorerProgress).not.toHaveBeenCalled();
        });

        it('submits the saved document even if the user switched editors during a slow save', async () => {
            const snapshot = createSnapshot();
            const document = { getText: () => 'saved main', save: vi.fn(async () => true) };
            submissionWorkspace.readActiveSourceFile
                .mockResolvedValueOnce({
                    filename: 'main.cpp', sourceCode: 'unsaved main', uri: fileUri('/workspace/main.cpp'), document, isDirty: true,
                })
                .mockResolvedValue({
                    filename: 'other.py', sourceCode: 'print(1)', uri: fileUri('/workspace/other.py'), isDirty: false,
                });
            showWarningMessage.mockResolvedValue('Save and Submit');
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(submissionWorkspace.readSourceDocument).toHaveBeenCalledWith(document);
            expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({
                code: Buffer.from('saved main', 'utf-8').toString('base64'),
                filename: 'main.cpp',
            }));
        });

        it('passes the resolved poll interval through unchanged', async () => {
            const snapshot = createSnapshot();
            resolvePollIntervalMs.mockReturnValue(2500);
            sessionApi.submitSolution.mockResolvedValue(pending());

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledWith(expect.objectContaining({ pollIntervalMs: 2500 }));
        });

        it('neither saves nor submits when the unsaved-changes prompt is cancelled', async () => {
            const snapshot = createSnapshot();
            const document = { save: vi.fn(async () => true), getText: vi.fn(() => '') };
            submissionWorkspace.readActiveSourceFile.mockResolvedValue({
                filename: 'main.cpp', sourceCode: 'x', uri: fileUri('/workspace/main.cpp'), document, isDirty: true,
            });
            showWarningMessage.mockResolvedValue(undefined);

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(document.save).not.toHaveBeenCalled();
            expect(sessionApi.submitSolution).not.toHaveBeenCalled();
        });

        it('polls a pending submission with an abort signal and shows Accepted as an information toast', async () => {
            const snapshot = createSnapshot();
            const final = { ...pending(), status: 'ACCEPTED' };
            sessionApi.submitSolution.mockResolvedValue(pending());
            pollResolves(final);
            showInformationMessage.mockResolvedValue('View Details');

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);
            await flushPromises();

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledWith({
                baseUrl: 'https://api.autojudge.test',
                context,
                pollIntervalMs: 1500,
                signal: expect.any(Object),
                tracker: expect.any(Object),
            });
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith({ ...snapshot, submissions: [final] });
            expect(statusBar.setPendingCount).toHaveBeenLastCalledWith(0);
            expect(showInformationMessage).toHaveBeenCalledWith('Accepted: A. A + B (#27)', 'View Details');
            expect(showWarningMessage).not.toHaveBeenCalledWith(expect.stringContaining('#27'), expect.anything());
            // View Details opens the submission page.
            expect(writtenPaths()).toContain(`${ROOT}/submission-details/Submission 27 · A. A + B.md`);
            expect(result).toEqual(final);
        });

        it('shows a rejected verdict as a warning with View Details and Compare Output', async () => {
            const snapshot = createSnapshot();
            const final = { ...pending(), status: 'WRONG_ANSWER', hint: { expected: '3\n', received: '4\n' } };
            sessionApi.submitSolution.mockResolvedValue(pending());
            pollResolves(final);
            showWarningMessage.mockImplementation(async (message) => {
                if (message.startsWith('Submit ')) {
                    return 'Submit';
                }
                return message.startsWith('Wrong Answer') ? 'Compare Output' : undefined;
            });

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);
            await flushPromises();

            expect(showWarningMessage).toHaveBeenCalledWith('Wrong Answer on A. A + B (#27)', 'View Details', 'Compare Output');
            expect(showInformationMessage).not.toHaveBeenCalled();
            expect(executeCommand).toHaveBeenCalledWith(
                'vscode.diff',
                fileUri(`${ROOT}/submission-output/27/expected.txt`),
                fileUri(`${ROOT}/submission-output/27/received.txt`),
                'Submission #27: expected ↔ received',
            );
        });

        it('returns without awaiting the verdict toast', async () => {
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockResolvedValue(pending());
            pollResolves({ ...pending(), status: 'ACCEPTED' });
            showInformationMessage.mockReturnValue(new Promise(() => {}));

            await expect(buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]))
                .resolves.toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
        });

        it('only logs when the submission is still pending after the poll timeout', async () => {
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockResolvedValue(pending());

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(outputChannel.appendLine).toHaveBeenCalledWith('Submission #27 is still being judged. Checking again in 30 s.');
            expect(showInformationMessage).not.toHaveBeenCalled();
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(result).toEqual(pending());
        });

        it('handles an ended session found while polling a submission verdict', async () => {
            const snapshot = createSnapshot();
            sessionApi.submitSolution.mockResolvedValue(pending(5));
            sessionApi.pollSubmissionResults.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'ended'));

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);
            await flushPromises();

            expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
            expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Your session ended'), 'Log In');
            expect(showErrorMessage).not.toHaveBeenCalled();
        });

        it('stamps the problem and submittedAt on a judge response that is only { id, status }', async () => {
            const snapshot = createSnapshot();
            snapshot.submissions = [
                { id: 20, status: 'WRONG_ANSWER', problem: { publicId: 'pa1b2c3d4e5f6' }, submittedAt: '2026-05-28T03:30:00.000Z' },
            ];
            sessionApi.submitSolution.mockResolvedValue({ id: 28, status: 'ACCEPTED' });

            await buildLoggedInController(snapshot, { now: () => Date.parse('2026-05-28T04:00:00.000Z') })
                .submitActiveFile(snapshot.problems[0]);

            expect(treeProvider.setSnapshot).toHaveBeenCalledWith(expect.objectContaining({
                submissions: [
                    {
                        id: 28,
                        status: 'ACCEPTED',
                        problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                        submittedAt: '2026-05-28T04:00:00.000Z',
                    },
                    snapshot.submissions[0],
                ],
            }));
            expect(sessionApi.pollSubmissionResults).not.toHaveBeenCalled();
        });
    });

    describe('auto-polling pending submissions', () => {
        it('polls every pending submission once after a refresh, even when refreshed again', async () => {
            const snapshot = {
                ...createSnapshot(),
                submissions: [
                    { id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } },
                    { id: 2, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' } },
                    { id: 3, status: 'JUDGING', problem: { publicId: 'pa1b2c3d4e5f6' } },
                ],
            };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await controller.refreshTree();

            // One shared loop checks every pending id.
            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(1);
            expect(trackedIds()).toEqual(['1', '3']);
            expect(statusBar.setPendingCount).toHaveBeenLastCalledWith(2);
        });

        it('re-polls a timed-out submission after a 30 s backoff', async () => {
            vi.useFakeTimers();
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            sessionApi.refreshContestDetails.mockResolvedValue(snapshot.contest);
            pollTimesOut();
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(outputChannel.appendLine).toHaveBeenCalledWith('Submission #1 is still being judged. Checking again in 30 s.');
            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(1);

            pollHangs();
            await vi.advanceTimersByTimeAsync(29999);
            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);

            // The timed-out id left the pending set, so it is tracked again.
            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(2);
            expect(trackedIds(1)).toEqual(['1']);
        });

        it('logs a submission stuck in the judge as still being judged only once', async () => {
            vi.useFakeTimers();
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            sessionApi.refreshContestDetails.mockResolvedValue(snapshot.contest);
            pollTimesOut();
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await vi.advanceTimersByTimeAsync(90000);

            expect(sessionApi.pollSubmissionResults.mock.calls.length).toBeGreaterThan(2);
            expect(outputChannel.appendLine.mock.calls.filter(([line]) => line.includes('still being judged'))).toHaveLength(1);
        });

        it('does not re-poll a timed-out submission after logout', async () => {
            vi.useFakeTimers();
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            pollTimesOut();
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await vi.advanceTimersByTimeAsync(0);
            await controller.logoutTeam();
            await vi.advanceTimersByTimeAsync(60000);

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(1);
        });

        it('starts a fresh loop for a submission tracked while the previous loop was ending', async () => {
            const first = { ...createSnapshot(), submissions: [{ id: 40, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            const second = {
                ...first,
                submissions: [
                    { id: 41, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } },
                    { id: 40, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' } },
                ],
            };
            sessionApi.restoreContestSession.mockResolvedValueOnce(first).mockResolvedValue(second);
            const controller = buildController();
            sessionApi.pollSubmissionResults.mockImplementationOnce(async ({ tracker }) => {
                tracker.ids();
                await tracker.resolve({ id: 40, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' } });
                expect(tracker.ids()).toEqual([]);
                // Tracked after the loop saw an empty set, before it returned.
                await controller.refreshTree({ silent: true });
            });

            await controller.refreshTree({ silent: true });
            await flushPromises(30);

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(2);
            expect(trackedIds(1)).toEqual(['41']);
        });

        it('does not spin when a poll loop returns while its ids are still tracked', async () => {
            const snapshot = { ...createSnapshot(), submissions: [{ id: 40, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            sessionApi.pollSubmissionResults.mockImplementation(async ({ tracker }) => {
                tracker.ids();
            });

            await buildController().refreshTree({ silent: true });
            await flushPromises(30);

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(1);
        });

        it('logs a failed check once per message and keeps the submission tracked', async () => {
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            const { tracker } = sessionApi.pollSubmissionResults.mock.calls[0][0];
            tracker.onError(new Error('fetch failed'));
            tracker.onError(new Error('fetch failed'));

            expect(outputChannel.appendLine.mock.calls.filter(([line]) => line.includes('fetch failed'))).toHaveLength(1);
            expect(tracker.ids()).toEqual(['1']);
        });

        it('logs a recurring check failure again after a successful check', async () => {
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            const { tracker } = sessionApi.pollSubmissionResults.mock.calls[0][0];
            tracker.onError(new Error('fetch failed'));
            tracker.onSuccess();
            tracker.onError(new Error('fetch failed'));

            expect(outputChannel.appendLine.mock.calls.filter(([line]) => line.includes('fetch failed'))).toHaveLength(2);
        });

        it('stops tracking with an error toast when the poll loop cannot run for a user submit', async () => {
            const snapshot = createSnapshot();
            showWarningMessage.mockResolvedValue('Submit');
            sessionApi.submitSolution.mockResolvedValue({ id: 41, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } });
            sessionApi.pollSubmissionResults.mockRejectedValue(new Error('Log in to AutoJudge Contest before checking a submission result.'));

            const result = await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(result).toEqual(expect.objectContaining({ id: 41, status: 'PENDING' }));
            expect(showErrorMessage).toHaveBeenCalledWith('Could not check submission #41: Log in to AutoJudge Contest before checking a submission result.');
        });

        it('stops polling on logout and ignores a verdict that arrives afterwards', async () => {
            const snapshot = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(snapshot);
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            const { signal, tracker } = sessionApi.pollSubmissionResults.mock.calls[0][0];
            await controller.logoutTeam();

            expect(signal.aborted).toBe(true);
            await tracker.resolve({ id: 1, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' } });
            await flushPromises();

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(null);
            expect(showInformationMessage).not.toHaveBeenCalled();
        });
    });

    describe('stale results across sessions', () => {
        /**
         * Build a promise whose settlement the test controls.
         * @returns {{ promise: Promise<unknown>, resolve: Function, reject: Function }}
         */
        function deferred() {
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            return { promise, resolve, reject };
        }

        /**
         * A snapshot for the session created by a new login.
         * @returns {object}
         */
        function newSessionSnapshot() {
            return { ...createSnapshot(), token: 'new-token', submissions: [] };
        }

        it('ignores an ended-session error from a restore that started before a new login', async () => {
            const restore = deferred();
            sessionApi.restoreContestSession.mockReturnValue(restore.promise);
            const fresh = newSessionSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            const controller = buildController();

            const startup = controller.refreshTree({ silent: true });
            await controller.loginTeam();
            restore.reject(apiError(401, 'SESSION_ENDED', 'ended'));
            await startup;
            await flushPromises();

            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
            expect(setContext).toHaveBeenLastCalledWith('autojudgeContest.state', 'loggedIn');
        });

        it('ignores a restore that resolves after logout', async () => {
            const restore = deferred();
            sessionApi.restoreContestSession.mockReturnValue(restore.promise);
            const controller = buildController();

            const refresh = controller.refreshTree();
            await controller.logoutTeam();
            restore.resolve(createSnapshot());
            await expect(refresh).resolves.toBeNull();

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(null);
            expect(setContext).toHaveBeenLastCalledWith('autojudgeContest.state', 'loggedOut');
        });

        it('drops a standings refresh that started before logout and a new login', async () => {
            vi.useFakeTimers();
            const old = createSnapshot();
            const refresh = deferred();
            sessionApi.refreshContestDetails.mockReturnValue(refresh.promise);
            const fresh = newSessionSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            sessionApi.restoreContestSession.mockResolvedValue(old);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            await vi.advanceTimersByTimeAsync(15000);
            expect(sessionApi.refreshContestDetails).toHaveBeenCalledTimes(1);
            await controller.logoutTeam();
            await controller.loginTeam();
            refresh.resolve({ ...old.contest, name: 'Old session contest' });
            await flushPromises();

            expect(teamsStandingsProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
            expect(statusBar.update).toHaveBeenLastCalledWith(fresh);
        });

        it('starts no restore or standings refresh while a login redeems its code', async () => {
            vi.useFakeTimers();
            const old = createSnapshot();
            const redeem = deferred();
            sessionApi.restoreContestSession.mockResolvedValue(old);
            sessionApi.refreshContestDetails.mockResolvedValue(old.contest);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockReturnValue(redeem.promise);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            const login = controller.loginTeam();
            await flushPromises();
            await controller.refreshTree();
            await vi.advanceTimersByTimeAsync(15000);

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(1);
            expect(sessionApi.refreshContestDetails).not.toHaveBeenCalled();

            const fresh = newSessionSnapshot();
            redeem.resolve(fresh);
            await login;
            await controller.refreshTree();

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);
        });

        it.each([
            ['an invalid hand-off code', apiError(400, 'HANDOFF_INVALID', 'expired')],
            ['a network error', new Error('fetch failed')],
        ])('clears the redeem guard when redeeming fails with %s', async (_label, failure) => {
            vi.useFakeTimers();
            const old = createSnapshot();
            sessionApi.restoreContestSession.mockResolvedValue(old);
            sessionApi.refreshContestDetails.mockResolvedValue(old.contest);
            browserLogin.waitForHandoffCode.mockResolvedValue('used-code');
            sessionApi.redeemAndLoadContest.mockRejectedValue(failure);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            await controller.loginTeam();
            await controller.refreshTree();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(15000);
            expect(sessionApi.refreshContestDetails).toHaveBeenCalledTimes(1);
        });

        it('keeps skipping restore and standings while a second login still redeems after the first settles', async () => {
            vi.useFakeTimers();
            const old = createSnapshot();
            const redeemA = deferred();
            const redeemB = deferred();
            const snapshotA = { ...newSessionSnapshot(), token: 'a-token' };
            const snapshotB = newSessionSnapshot();
            sessionApi.restoreContestSession.mockResolvedValue(old);
            sessionApi.refreshContestDetails.mockResolvedValue(old.contest);
            browserLogin.waitForHandoffCode.mockResolvedValueOnce('code-a').mockResolvedValueOnce('code-b');
            sessionApi.redeemAndLoadContest.mockReturnValueOnce(redeemA.promise).mockReturnValueOnce(redeemB.promise);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            const loginA = controller.loginTeam();
            await flushPromises();
            const loginB = controller.loginTeam();
            await flushPromises();
            redeemA.resolve(snapshotA);
            await expect(loginA).resolves.toBeNull();
            await controller.refreshTree();
            await vi.advanceTimersByTimeAsync(15000);

            // B is still redeeming: nothing may read the old token or show A.
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(1);
            expect(sessionApi.refreshContestDetails).not.toHaveBeenCalled();
            expect(treeProvider.setSnapshot).not.toHaveBeenCalledWith(snapshotA);

            redeemB.resolve(snapshotB);
            await expect(loginB).resolves.toBe(snapshotB);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(snapshotB);
            await controller.refreshTree();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);
        });

        it('drops the snapshot of a login that redeems after a newer login already showed its own', async () => {
            const redeemA = deferred();
            const snapshotA = { ...newSessionSnapshot(), token: 'a-token' };
            const snapshotB = newSessionSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValueOnce('code-a').mockResolvedValueOnce('code-b');
            sessionApi.redeemAndLoadContest.mockReturnValueOnce(redeemA.promise).mockResolvedValueOnce(snapshotB);
            const controller = buildController();

            const loginA = controller.loginTeam();
            await flushPromises();
            await controller.loginTeam();
            redeemA.resolve(snapshotA);
            await expect(loginA).resolves.toBeNull();

            expect(treeProvider.setSnapshot).not.toHaveBeenCalledWith(snapshotA);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(snapshotB);
            const loggedIn = outputChannel.appendLine.mock.calls.filter(([line]) => line.startsWith('Logged in as'));
            expect(loggedIn).toHaveLength(1);
        });

        it('keeps the new token when an upload from the old session ends with SESSION_ENDED', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const old = createSnapshot();
            const upload = deferred();
            sessionApi.submitSolution.mockReturnValue(upload.promise);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            const fresh = newSessionSnapshot();
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            const controller = buildLoggedInController(old);

            const submit = controller.submitActiveFile(old.problems[0]);
            await flushPromises(30);
            await controller.loginTeam();
            upload.reject(apiError(401, 'SESSION_ENDED', 'ended'));
            await expect(submit).resolves.toBeNull();
            await flushPromises();

            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
        });

        it('does not merge an old-session upload result into the new snapshot', async () => {
            resolveConfirmBeforeSubmit.mockReturnValue(false);
            const old = createSnapshot();
            const upload = deferred();
            sessionApi.submitSolution.mockReturnValue(upload.promise);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            const fresh = newSessionSnapshot();
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            const controller = buildLoggedInController(old);

            const submit = controller.submitActiveFile(old.problems[0]);
            await flushPromises(30);
            await controller.loginTeam();
            upload.resolve({ id: 99, status: 'PENDING' });
            await expect(submit).resolves.toEqual({ id: 99, status: 'PENDING' });

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
            expect(sessionApi.pollSubmissionResults).not.toHaveBeenCalled();
        });

        it('ignores a restore from the old session that fails after a new login', async () => {
            const restore = deferred();
            sessionApi.restoreContestSession.mockReturnValue(restore.promise);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            const fresh = newSessionSnapshot();
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            const controller = buildController();

            const refresh = controller.refreshTree();
            await controller.loginTeam();
            const contextCalls = setContext.mock.calls.length;
            restore.reject(new Error('fetch failed'));
            await expect(refresh).resolves.toBeNull();
            await flushPromises();

            expect(setContext).toHaveBeenCalledTimes(contextCalls);
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(outputChannel.appendLine).not.toHaveBeenCalledWith(expect.stringContaining('Could not load the contest'));
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
        });

        it('ignores a standings refresh from the old session that fails after a new login', async () => {
            vi.useFakeTimers();
            const old = createSnapshot();
            const refresh = deferred();
            sessionApi.refreshContestDetails.mockReturnValue(refresh.promise);
            sessionApi.restoreContestSession.mockResolvedValue(old);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(newSessionSnapshot());
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            await vi.advanceTimersByTimeAsync(15000);
            await controller.loginTeam();
            refresh.reject(new Error('fetch failed'));
            await flushPromises();

            expect(outputChannel.appendLine).not.toHaveBeenCalledWith(expect.stringContaining('Standings refresh failed'));
        });

        it('stops old polls on a new login and ignores their verdicts', async () => {
            const old = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            const poll = deferred();
            sessionApi.restoreContestSession.mockResolvedValue(old);
            sessionApi.pollSubmissionResults.mockReturnValue(poll.promise);
            const fresh = newSessionSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(fresh);
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            const { signal, tracker } = sessionApi.pollSubmissionResults.mock.calls[0][0];
            await controller.loginTeam();

            expect(signal.aborted).toBe(true);
            await tracker.resolve({ id: 1, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6' } });
            poll.resolve();
            await flushPromises();

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(fresh);
            expect(showInformationMessage).not.toHaveBeenCalled();
            expect(showWarningMessage).not.toHaveBeenCalled();
        });

        it('resumes the shown session polls when redeeming the new login fails', async () => {
            const old = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            sessionApi.restoreContestSession.mockResolvedValue(old);
            browserLogin.waitForHandoffCode.mockResolvedValue('used-code');
            sessionApi.redeemAndLoadContest.mockRejectedValue(apiError(400, 'HANDOFF_INVALID', 'expired'));
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await controller.loginTeam();

            expect(sessionApi.pollSubmissionResults).toHaveBeenCalledTimes(2);
            expect(sessionApi.pollSubmissionResults.mock.calls[1][0].signal.aborted).toBe(false);
            expect(trackedIds(1)).toEqual(['1']);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(old);
        });

        it('ignores an ended-session error from an old poll that ignores the abort', async () => {
            const old = { ...createSnapshot(), submissions: [{ id: 1, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6' } }] };
            const poll = deferred();
            sessionApi.restoreContestSession.mockResolvedValue(old);
            sessionApi.pollSubmissionResults.mockReturnValue(poll.promise);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(newSessionSnapshot());
            const controller = buildController();

            await controller.refreshTree({ silent: true });
            await controller.loginTeam();
            poll.reject(apiError(401, 'SESSION_ENDED', 'ended'));
            await flushPromises();

            expect(sessionApi.clearStoredSession).not.toHaveBeenCalled();
        });
    });

    describe('compare output', () => {
        it('writes expected and received output and opens a diff', async () => {
            const submission = { id: 852, status: 'WRONG_ANSWER', hint: { expected: '3\n', received: '4\n' } };

            const result = await buildController().compareSubmissionOutput({ submission });

            expect(pageFiles.writeComparison).toHaveBeenCalledWith(852, '3\n', '4\n');
            expect(executeCommand).toHaveBeenCalledWith(
                'vscode.diff',
                fileUri(`${ROOT}/submission-output/852/expected.txt`),
                fileUri(`${ROOT}/submission-output/852/received.txt`),
                'Submission #852: expected ↔ received',
            );
            expect(result).toEqual({
                expectedPath: `${ROOT}/submission-output/852/expected.txt`,
                receivedPath: `${ROOT}/submission-output/852/received.txt`,
            });
        });

        it('shows an information message when the submission has no output to compare', async () => {
            const result = await buildController().compareSubmissionOutput({ id: 9, status: 'ACCEPTED' });

            expect(result).toBeNull();
            expect(showInformationMessage).toHaveBeenCalledWith('Submission #9 has no expected and received output to compare.');
            expect(executeCommand).not.toHaveBeenCalled();
        });

        it.each([
            ['only expected', { expected: '3\n' }],
            ['only received', { received: '4\n' }],
        ])('does not open a one-sided diff when the submission has %s output', async (_label, hint) => {
            const result = await buildController().compareSubmissionOutput({ id: 10, status: 'WRONG_ANSWER', hint });

            expect(result).toBeNull();
            expect(pageFiles.writeComparison).not.toHaveBeenCalled();
            expect(executeCommand).not.toHaveBeenCalled();
            expect(showInformationMessage).toHaveBeenCalledWith('Submission #10 has no expected and received output to compare.');
        });

        it('offers only View Details in the verdict toast when the output is one-sided', async () => {
            const snapshot = createSnapshot();
            const submitted = { id: 31, status: 'WRONG_ANSWER', hint: { received: '4\n' }, problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' } };
            showWarningMessage.mockImplementation(async (message) => (message.startsWith('Submit ') ? 'Submit' : undefined));
            sessionApi.submitSolution.mockResolvedValue(submitted);

            await buildLoggedInController(snapshot).submitActiveFile(snapshot.problems[0]);

            expect(showWarningMessage).toHaveBeenCalledWith('Wrong Answer on A. A + B (#31)', 'View Details');
        });
    });

    describe('export public cases', () => {
        const exportResult = {
            destinationUri: fileUri('/workspace/cases'),
            writtenPairs: [{
                inputUri: fileUri('/workspace/cases/a-b-testcase-01.in'),
                outputUri: fileUri('/workspace/cases/a-b-testcase-01.out'),
            }],
        };

        it('exports into the picked folder and offers Reveal in Explorer', async () => {
            const snapshot = createSnapshot();
            submissionWorkspace.exportPublicCases.mockResolvedValue(exportResult);
            showInformationMessage.mockResolvedValue('Reveal in Explorer');

            const result = await buildLoggedInController(snapshot).exportPublicCases({ problem: snapshot.problems[0] });
            await flushPromises();

            expect(submissionWorkspace.findExistingCaseFiles).toHaveBeenCalledWith(snapshot.problems[0], 1, fileUri('/workspace/cases'));
            expect(submissionWorkspace.exportPublicCases).toHaveBeenCalledWith(
                snapshot.problems[0],
                [{ input: '1 2\n', output: '3\n' }],
                { directoryUri: fileUri('/workspace/cases') },
            );
            expect(showInformationMessage).toHaveBeenCalledWith(
                'Exported 1 public test case for A. A + B.',
                'Reveal in Explorer',
                'Open First Case',
            );
            expect(executeCommand).toHaveBeenCalledWith('revealInExplorer', exportResult.writtenPairs[0].inputUri);
            expect(result).toBe(exportResult);
        });

        it('opens the first input file when Open First Case is chosen', async () => {
            submissionWorkspace.exportPublicCases.mockResolvedValue(exportResult);
            showInformationMessage.mockResolvedValue('Open First Case');

            await buildController().exportPublicCases({ publicId: 'pa1b2c3d4e5f6', title: 'A + B', input: '1 2\n', output: '3\n' });
            await flushPromises();

            expect(openTextDocument).toHaveBeenCalledWith(exportResult.writtenPairs[0].inputUri);
            expect(showTextDocument).toHaveBeenCalled();
        });

        it('returns quietly when the folder dialog is cancelled', async () => {
            submissionWorkspace.pickExportDirectory.mockResolvedValue(undefined);
            const snapshot = createSnapshot();

            const result = await buildLoggedInController(snapshot).exportPublicCases(snapshot.problems[0]);

            expect(result).toBeNull();
            expect(submissionWorkspace.exportPublicCases).not.toHaveBeenCalled();
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(showInformationMessage).not.toHaveBeenCalled();
        });

        it('asks before replacing existing test case files and stops when declined', async () => {
            const snapshot = createSnapshot();
            submissionWorkspace.findExistingCaseFiles.mockResolvedValue([
                fileUri('/workspace/cases/a-b-testcase-01.in'),
                fileUri('/workspace/cases/a-b-testcase-01.out'),
            ]);
            showWarningMessage.mockResolvedValue(undefined);

            const result = await buildLoggedInController(snapshot).exportPublicCases(snapshot.problems[0]);

            expect(showWarningMessage).toHaveBeenCalledWith('Replace 2 existing test case files in cases?', { modal: true }, 'Replace');
            expect(submissionWorkspace.exportPublicCases).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('replaces existing files when Replace is chosen', async () => {
            const snapshot = createSnapshot();
            submissionWorkspace.findExistingCaseFiles.mockResolvedValue([fileUri('/workspace/cases/a-b-testcase-01.in')]);
            submissionWorkspace.exportPublicCases.mockResolvedValue(exportResult);
            showWarningMessage.mockResolvedValue('Replace');

            await buildLoggedInController(snapshot).exportPublicCases(snapshot.problems[0]);

            expect(showWarningMessage).toHaveBeenCalledWith('Replace 1 existing test case file in cases?', { modal: true }, 'Replace');
            expect(submissionWorkspace.exportPublicCases).toHaveBeenCalledTimes(1);
        });

        it('shows an information message when the problem has no public test cases', async () => {
            const snapshot = createFullSnapshot();

            const result = await buildLoggedInController(snapshot).exportPublicCases(snapshot.problems[1]);

            expect(result).toBeNull();
            expect(showInformationMessage).toHaveBeenCalledWith('B. Binary Search has no public test cases.');
            expect(showErrorMessage).not.toHaveBeenCalled();
            expect(submissionWorkspace.pickExportDirectory).not.toHaveBeenCalled();
        });
    });

    describe('refresh cadence', () => {
        /**
         * Log in with fake timers and the given views.
         * @param {object} views
         * @returns {Promise<{ controller: object, snapshot: object }>}
         */
        async function loginWithViews(views) {
            vi.useFakeTimers();
            const snapshot = createSnapshot();
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(snapshot);
            sessionApi.refreshContestDetails.mockResolvedValue({ ...snapshot.contest, name: 'Regional Final (live)' });
            const controller = buildController(views);
            await controller.loginTeam();
            return { controller, snapshot };
        }

        it('refreshes standings every 15 s while Standings is visible, without re-rendering the explorer', async () => {
            const teamsView = createFakeView(true);
            const { snapshot } = await loginWithViews({ teamsView, explorerView: createFakeView(true) });
            const explorerSetCalls = treeProvider.setSnapshot.mock.calls.length;

            await vi.advanceTimersByTimeAsync(15000);

            expect(sessionApi.refreshContestDetails).toHaveBeenCalledWith({
                baseUrl: 'https://api.autojudge.test',
                contest: snapshot.contest,
                context,
            });
            expect(teamsStandingsProvider.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
                contest: expect.objectContaining({ name: 'Regional Final (live)' }),
            }));
            expect(statusBar.update).toHaveBeenLastCalledWith(expect.objectContaining({
                contest: expect.objectContaining({ name: 'Regional Final (live)' }),
            }));
            expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(explorerSetCalls);
            expect(treeProvider.refresh).not.toHaveBeenCalled();
        });

        it('refreshes standings every 60 s while Standings is hidden and at once when it becomes visible', async () => {
            const teamsView = createFakeView(false);
            await loginWithViews({ teamsView, explorerView: createFakeView(false) });

            await vi.advanceTimersByTimeAsync(15000);
            expect(sessionApi.refreshContestDetails).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(45000);
            expect(sessionApi.refreshContestDetails).toHaveBeenCalledTimes(1);

            teamsView.setVisible(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(sessionApi.refreshContestDetails).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(15000);
            expect(sessionApi.refreshContestDetails).toHaveBeenCalledTimes(3);
        });

        it('re-renders the explorer every 60 s only while it is visible', async () => {
            const explorerView = createFakeView(false);
            await loginWithViews({ teamsView: createFakeView(false), explorerView });
            const setCalls = treeProvider.setSnapshot.mock.calls.length;

            await vi.advanceTimersByTimeAsync(60000);
            expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(setCalls);

            explorerView.setVisible(true);
            expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(setCalls + 1);

            await vi.advanceTimersByTimeAsync(60000);
            expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(setCalls + 2);
        });

        it('pushes the contest refreshed by the standings timer to the explorer on its 60 s tick', async () => {
            await loginWithViews({ teamsView: createFakeView(true), explorerView: createFakeView(true) });

            await vi.advanceTimersByTimeAsync(60000);

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
                contest: expect.objectContaining({ name: 'Regional Final (live)' }),
            }));
        });

        it('stops all timers on logout', async () => {
            const { controller } = await loginWithViews({ teamsView: createFakeView(true), explorerView: createFakeView(true) });

            await controller.logoutTeam();
            const setCalls = treeProvider.setSnapshot.mock.calls.length;
            await vi.advanceTimersByTimeAsync(120000);

            expect(sessionApi.refreshContestDetails).not.toHaveBeenCalled();
            expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(setCalls);
        });

        it('reloads the contest silently once a standings refresh shows it has started', async () => {
            vi.useFakeTimers();
            const startTime = '2026-05-28T04:00:10.000Z';
            const waiting = { ...createSnapshot(), problems: [], contestNotStarted: true };
            waiting.contest = { ...waiting.contest, startTime };
            const started = { ...createSnapshot(), contestNotStarted: false };
            sessionApi.restoreContestSession.mockResolvedValueOnce(waiting).mockResolvedValue(started);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            // Still before the start: no reload.
            await vi.advanceTimersByTimeAsync(15000);
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(1);

            clock = Date.parse(startTime) + 1000;
            await vi.advanceTimersByTimeAsync(15000);

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(started);
            expect(withExplorerProgress).not.toHaveBeenCalled();
            expect(showErrorMessage).not.toHaveBeenCalled();
        });

        it('backs off to one reload a minute while the server still says not started, then loads the problems', async () => {
            vi.useFakeTimers();
            const startTime = '2026-05-28T03:59:00.000Z';
            const waiting = { ...createSnapshot(), problems: [], contestNotStarted: true };
            waiting.contest = { ...waiting.contest, startTime };
            const started = { ...createSnapshot(), contestNotStarted: false };
            sessionApi.restoreContestSession.mockResolvedValue(waiting);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            // The local clock is past the start, but the server disagrees for 2 min.
            for (let tick = 0; tick < 8; tick += 1) {
                clock += 15000;
                await vi.advanceTimersByTimeAsync(15000);
            }

            // Startup restore + one reload at 15 s, 75 s and 135 s at most.
            expect(sessionApi.restoreContestSession.mock.calls.length).toBeLessThanOrEqual(3);
            const lines = outputChannel.appendLine.mock.calls.map(([line]) => line);
            expect(lines.filter(line => line.startsWith('The contest has not started yet.'))).toHaveLength(1);
            expect(lines.filter(line => line.startsWith('The contest has started.'))).toHaveLength(1);

            sessionApi.restoreContestSession.mockResolvedValue(started);
            clock += 60000;
            await vi.advanceTimersByTimeAsync(60000);

            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(started);
        });

        it('logs the loaded line once per not-started period, not on every retry', async () => {
            vi.useFakeTimers();
            const waiting = createWaitingSnapshot();
            const started = { ...createSnapshot(), contestNotStarted: false };
            sessionApi.restoreContestSession.mockResolvedValue(waiting);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            // Startup restore, then retries at 15 s, 75 s and 135 s.
            for (let index = 0; index < 9; index += 1) {
                await tick();
            }
            const loadedLines = () => outputChannel.appendLine.mock.calls.filter(([line]) => line.startsWith('Loaded '));
            expect(sessionApi.restoreContestSession.mock.calls.length).toBeGreaterThanOrEqual(3);
            expect(loadedLines()).toHaveLength(1);

            sessionApi.restoreContestSession.mockResolvedValue(started);
            await controller.refreshTree();
            expect(loadedLines()).toHaveLength(2);
        });

        it('starts one contest-start reload even when standings ticks overlap it', async () => {
            vi.useFakeTimers();
            const startTime = '2026-05-28T03:59:00.000Z';
            const waiting = { ...createSnapshot(), problems: [], contestNotStarted: true };
            waiting.contest = { ...waiting.contest, startTime };
            let finishReload;
            sessionApi.restoreContestSession
                .mockResolvedValueOnce(waiting)
                .mockReturnValue(new Promise((resolve) => {
                    finishReload = resolve;
                }));
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            await vi.advanceTimersByTimeAsync(15000);
            await vi.advanceTimersByTimeAsync(15000);
            await vi.advanceTimersByTimeAsync(15000);

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);
            finishReload({ ...createSnapshot(), contestNotStarted: false });
        });

        /**
         * A contest whose start time the local clock already passed, but which
         * the server still reports as not started.
         * @returns {object}
         */
        function createWaitingSnapshot() {
            const waiting = { ...createSnapshot(), problems: [], contestNotStarted: true };
            waiting.contest = { ...waiting.contest, startTime: '2026-05-28T03:59:00.000Z' };
            return waiting;
        }

        /**
         * Advance the fake timers and the injected clock by one standings tick.
         */
        async function tick() {
            clock += 15000;
            await vi.advanceTimersByTimeAsync(15000);
        }

        it('does not delay the reload of a new session by the backoff of the previous one', async () => {
            vi.useFakeTimers();
            const waiting = createWaitingSnapshot();
            sessionApi.restoreContestSession.mockResolvedValue(waiting);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(waiting);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            // The reload at 15 s still finds "not started" and starts the backoff.
            await tick();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);

            await controller.logoutTeam();
            await controller.loginTeam();
            await tick();

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(3);
        });

        it('does not let a reload from an old session start the backoff of the new one', async () => {
            vi.useFakeTimers();
            const waiting = createWaitingSnapshot();
            let finishReload;
            sessionApi.restoreContestSession
                .mockResolvedValueOnce(waiting)
                .mockReturnValueOnce(new Promise((resolve) => {
                    finishReload = resolve;
                }))
                .mockResolvedValue(waiting);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            browserLogin.waitForHandoffCode.mockResolvedValue('handoff-code');
            sessionApi.redeemAndLoadContest.mockResolvedValue(waiting);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });

            await tick();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);
            await controller.logoutTeam();
            await controller.loginTeam();
            finishReload(waiting);
            await flushPromises();
            await tick();

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(3);
        });

        it('forgets the backoff once a restore finds the contest started, for a later not-started period', async () => {
            vi.useFakeTimers();
            const waiting = createWaitingSnapshot();
            const started = { ...createSnapshot(), contestNotStarted: false };
            sessionApi.restoreContestSession.mockResolvedValue(waiting);
            sessionApi.refreshContestDetails.mockImplementation(async ({ contest }) => contest);
            const controller = buildController({ teamsView: createFakeView(true) });
            await controller.refreshTree({ silent: true });
            await tick();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(2);

            // A manual refresh sees the contest started, then not started again.
            sessionApi.restoreContestSession.mockResolvedValueOnce(started).mockResolvedValue(waiting);
            await controller.refreshTree();
            await controller.refreshTree();
            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(4);
            await tick();

            expect(sessionApi.restoreContestSession).toHaveBeenCalledTimes(5);
            const lines = outputChannel.appendLine.mock.calls.map(([line]) => line);
            expect(lines.filter(line => line.startsWith('The contest has started.'))).toHaveLength(2);
        });

        it('handles an ended session found by the timed standings refresh', async () => {
            await loginWithViews({});
            sessionApi.refreshContestDetails.mockRejectedValue(apiError(401, 'SESSION_ENDED', 'ended'));

            await vi.advanceTimersByTimeAsync(15000);

            expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
            expect(treeProvider.setSnapshot).toHaveBeenLastCalledWith(null);
            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(outputChannel.appendLine).not.toHaveBeenCalledWith(expect.stringContaining('Standings refresh failed'));
        });
    });
});

describe('logToChannel', () => {
    it('uses the LogOutputChannel level methods when available', () => {
        const channel = { appendLine: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

        logToChannel(channel, 'info', 'a');
        logToChannel(channel, 'warn', 'b');
        logToChannel(channel, 'error', 'c');

        expect(channel.info).toHaveBeenCalledWith('a');
        expect(channel.warn).toHaveBeenCalledWith('b');
        expect(channel.error).toHaveBeenCalledWith('c');
        expect(channel.appendLine).not.toHaveBeenCalled();
    });

    it('falls back to appendLine for plain channels', () => {
        const channel = { appendLine: vi.fn() };

        logToChannel(channel, 'error', 'failed');

        expect(channel.appendLine).toHaveBeenCalledWith('failed');
    });
});
