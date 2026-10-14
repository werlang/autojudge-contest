import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    mkdir: fsState.mkdir,
    writeFile: fsState.writeFile,
}));

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key, fallbackValue) => fallbackValue,
        }),
    },
}), { virtual: true });

import { createContestController } from '../src/controllers/contest-controller.js';

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

describe('contest controller', () => {
    let context;
    let outputChannel;
    let openTextDocument;
    let promptTeamCredentials;
    let resolvePollIntervalMs;
    let resolveBaseUrl;
    let sessionApi;
    let executeCommand;
    let setContext;
    let showTextDocument;
    let showInformationMessage;
    let showErrorMessage;
    let withProgressNotification;
    let submissionWorkspace;
    let teamsStandingsProvider;
    let treeProvider;

    beforeEach(() => {
        context = {
            id: 'extension-context',
            storageUri: {
                fsPath: '/workspace/.autojudge-state',
            },
        };
        outputChannel = {
            appendLine: vi.fn(),
            clear: vi.fn(),
            show: vi.fn(),
        };
        fsState.mkdir.mockReset();
        fsState.writeFile.mockReset();
        openTextDocument = vi.fn();
        promptTeamCredentials = vi.fn();
        resolvePollIntervalMs = vi.fn(() => 1500);
        resolveBaseUrl = vi.fn(() => 'https://api.autojudge.test');
        sessionApi = {
            clearStoredSession: vi.fn(),
            loginAndLoadContest: vi.fn(),
            pollSubmissionResult: vi.fn(),
            refreshContestDetails: vi.fn(),
            restoreContestSession: vi.fn(),
            submitSolution: vi.fn(),
        };
        executeCommand = vi.fn();
        setContext = vi.fn();
        showTextDocument = vi.fn();
        showInformationMessage = vi.fn();
        showErrorMessage = vi.fn();
        withProgressNotification = vi.fn(async (_title, task) => await task());
        submissionWorkspace = {
            exportPublicCases: vi.fn(),
            readActiveSourceFile: vi.fn(),
        };
        teamsStandingsProvider = {
            setSnapshot: vi.fn(),
        };
        treeProvider = {
            getSnapshot: vi.fn(() => null),
            setSnapshot: vi.fn(),
        };
    });

    it('logs in with prompted credentials and pushes the snapshot into the tree', async () => {
        const snapshot = createSnapshot();
        promptTeamCredentials.mockResolvedValue({ password: '123456', teamId: 'k3m9x2p7q8w1a' });
        sessionApi.loginAndLoadContest.mockResolvedValue(snapshot);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.loginTeam();

        expect(sessionApi.loginAndLoadContest).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            context,
            password: '123456',
            teamId: 'k3m9x2p7q8w1a',
        });
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
        expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedIn');
        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(result).toEqual(snapshot);
    });

    it('restores a saved session when refresh is invoked', async () => {
        const snapshot = createSnapshot();
        sessionApi.restoreContestSession.mockResolvedValue(snapshot);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.refreshTree();

        expect(sessionApi.restoreContestSession).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            context,
        });
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(snapshot);
        expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedIn');
        expect(result).toEqual(snapshot);
    });

    it('logs out by clearing storage and resetting the tree', async () => {
        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        await controller.logoutTeam();

        expect(sessionApi.clearStoredSession).toHaveBeenCalledWith(context);
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith(null);
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith(null);
        expect(setContext).toHaveBeenCalledWith('autojudgeContest.state', 'loggedOut');
    });

    it('opens a markdown problem preview from the clicked problem item', async () => {
        const document = { uri: 'file:///workspace/.autojudge-state/problem-previews/a-b.md' };
        openTextDocument.mockResolvedValue(document);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        await controller.openProblem({
            description: 'Add two integers.',
            order: 1,
            publicId: 'pa1b2c3d4e5f6',
            title: 'A + B',
        });

        expect(fsState.mkdir).toHaveBeenCalledWith('/workspace/.autojudge-state/problem-previews', {
            recursive: true,
        });
        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/problem-previews/a-b.md',
            expect.stringContaining('# A + B'),
            { encoding: 'utf-8' }
        );
        expect(fsState.writeFile.mock.calls[0][1]).toContain('Add two integers.');
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/problem-previews/a-b.md');
        expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', document.uri, expect.any(Object));
        expect(showTextDocument).not.toHaveBeenCalled();
        expect(showErrorMessage).not.toHaveBeenCalled();
    });

    it('opens a contest dashboard preview from the contest item', async () => {
        const document = { uri: 'file:///workspace/.autojudge-state/contest-dashboards/contest-k3m9x2p7q8w1a.md' };
        openTextDocument.mockResolvedValue(document);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const contest = {
            publicId: 'k3m9x2p7q8w1a',
            name: 'Regional Final',
            duration: 180,
            startTime: '2026-05-28T03:00:00.000Z',
        };

        const result = await controller.openContestDashboard(contest);

        expect(fsState.mkdir).toHaveBeenCalledWith('/workspace/.autojudge-state/contest-dashboards', {
            recursive: true,
        });
        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/contest-dashboards/contest-k3m9x2p7q8w1a.md',
            expect.stringContaining('# 🏆 Contest Dashboard: Regional Final'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/contest-dashboards/contest-k3m9x2p7q8w1a.md');
        expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', document.uri, expect.any(Object));
        expect(result).toEqual(contest);
    });

    it('opens a submission details preview from the clicked submission item', async () => {
        const document = { uri: 'file:///workspace/.autojudge-state/submission-details/submission-12.md' };
        openTextDocument.mockResolvedValue(document);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            withProgressNotification,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const submission = {
            id: 12,
            problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
            score: 90000,
            status: 'ACCEPTED',
            submittedAt: '2026-05-28T03:10:00.000Z',
        };

        const result = await controller.openSubmission(submission);

        expect(fsState.mkdir).toHaveBeenCalledWith('/workspace/.autojudge-state/submission-details', {
            recursive: true,
        });
        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/submission-details/submission-12.md',
            expect.stringContaining('# 📝 Submission #12'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/submission-details/submission-12.md');
        expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', document.uri, expect.any(Object));
        expect(result).toEqual(submission);
    });

    it('opens a team standing preview from the clicked standing item', async () => {
        const snapshot = createSnapshot();
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        const document = { uri: 'file:///workspace/.autojudge-state/team-details/team-tninjas7f3a00.md' };
        openTextDocument.mockResolvedValue(document);

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            withProgressNotification,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const team = snapshot.team.contest.teams[0];
        const result = await controller.openTeamStanding(team);

        expect(fsState.mkdir).toHaveBeenCalledWith('/workspace/.autojudge-state/team-details', {
            recursive: true,
        });
        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/team-details/team-tninjas7f3a00.md',
            expect.stringContaining('# 👥 Team Standing: Array Ninjas'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/team-details/team-tninjas7f3a00.md');
        expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', document.uri, expect.any(Object));
        expect(result).toEqual(team);
    });

    it('names the team standing preview by public id and ranks it from public-id standings', async () => {
        const snapshot = createSnapshot();
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        openTextDocument.mockResolvedValue({ uri: 'file:///workspace/.autojudge-state/team-details/team-tbits91cd0000.md' });

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        await controller.openTeamStanding(snapshot.contest.teams[1]);

        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/team-details/team-tbits91cd0000.md',
            expect.any(String),
            { encoding: 'utf-8' }
        );
        const [, content] = fsState.writeFile.mock.calls[0];
        expect(content).toContain('| **🏆 Rank** | **#2** |');
        expect(content).toContain('| **✅ Solved Problems** | 1 / 2 |');
        expect(content).toContain('> - A + B');
        expect(content).not.toContain('> - Binary Search');
    });

    it('submits the active file for the selected problem and refreshes the in-memory snapshot', async () => {
        const snapshot = createSnapshot();
        const createdSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        submissionWorkspace.readActiveSourceFile.mockResolvedValue({
            filename: 'main.cpp',
            sourceCode: '#include <iostream>\nint main() { return 0; }\n',
        });
        sessionApi.submitSolution.mockResolvedValue(createdSubmission);

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.submitActiveFile(snapshot.problems[0]);

        expect(sessionApi.submitSolution).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            code: Buffer.from('#include <iostream>\nint main() { return 0; }\n', 'utf-8').toString('base64'),
            context,
            filename: 'main.cpp',
            problemId: 'pa1b2c3d4e5f6',
        });
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith({
            ...snapshot,
            submissions: [createdSubmission],
        });
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenCalledWith({
            ...snapshot,
            submissions: [createdSubmission],
        });
        expect(showInformationMessage).toHaveBeenCalledWith('Submitted main.cpp to A + B.');
        expect(result).toEqual(createdSubmission);
    });

    it('submits to a public-id-only problem and keeps the public id on the local submission', async () => {
        const snapshot = createSnapshot();
        const [publicProblem] = snapshot.problems;
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        submissionWorkspace.readActiveSourceFile.mockResolvedValue({
            filename: 'main.cpp',
            sourceCode: 'int main() { return 0; }\n',
        });
        sessionApi.submitSolution.mockResolvedValue({ id: 28, status: 'ACCEPTED' });

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        await controller.submitActiveFile(publicProblem);

        expect(sessionApi.submitSolution).toHaveBeenCalledWith(expect.objectContaining({
            problemId: 'pa1b2c3d4e5f6',
        }));
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            submissions: [{ id: 28, status: 'ACCEPTED', problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' } }],
        }));
    });

    it('polls a pending submission until a final verdict arrives and refreshes the visible submission item', async () => {
        const snapshot = createSnapshot();
        const createdSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        const finalSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'ACCEPTED',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        submissionWorkspace.readActiveSourceFile.mockResolvedValue({
            filename: 'main.cpp',
            sourceCode: '#include <iostream>\nint main() { return 0; }\n',
        });
        sessionApi.submitSolution.mockResolvedValue(createdSubmission);
        sessionApi.pollSubmissionResult.mockResolvedValue(finalSubmission);

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            withProgressNotification,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.submitActiveFile(snapshot.problems[0]);

        expect(sessionApi.pollSubmissionResult).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            context,
            pollIntervalMs: 1500,
            submissionId: 27,
            timeoutMs: 120000,
        });
        expect(treeProvider.setSnapshot).toHaveBeenNthCalledWith(1, {
            ...snapshot,
            submissions: [createdSubmission],
        });
        expect(treeProvider.setSnapshot).toHaveBeenNthCalledWith(2, {
            ...snapshot,
            submissions: [finalSubmission],
        });
        expect(withProgressNotification).toHaveBeenCalledWith(
            'Waiting for the final verdict for submission #27.',
            expect.any(Function)
        );
        expect(showInformationMessage).toHaveBeenCalledWith('Submitted main.cpp to A + B.');
        expect(showInformationMessage).toHaveBeenCalledWith('Submission #27 finished with Accepted.');
        expect(result).toEqual(finalSubmission);
    });

    it('starts the judging progress notification without waiting for transient info messages to resolve', async () => {
        const snapshot = createSnapshot();
        const createdSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        const finalSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'ACCEPTED',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        let resolveSubmittedMessage;
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        submissionWorkspace.readActiveSourceFile.mockResolvedValue({
            filename: 'main.cpp',
            sourceCode: '#include <iostream>\nint main() { return 0; }\n',
        });
        sessionApi.submitSolution.mockResolvedValue(createdSubmission);
        sessionApi.pollSubmissionResult.mockResolvedValue(finalSubmission);
        showInformationMessage
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveSubmittedMessage = resolve;
            }))
            .mockResolvedValue(undefined);

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            withProgressNotification,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const pendingResult = controller.submitActiveFile(snapshot.problems[0]);

        await flushPromises();

        expect(withProgressNotification).toHaveBeenCalledWith(
            'Waiting for the final verdict for submission #27.',
            expect.any(Function)
        );
        expect(sessionApi.pollSubmissionResult).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            context,
            pollIntervalMs: 1500,
            submissionId: 27,
            timeoutMs: 120000,
        });

        resolveSubmittedMessage();

        await expect(pendingResult).resolves.toEqual(finalSubmission);
    });

    it('stops polling safely when the submission stays pending', async () => {
        const snapshot = createSnapshot();
        const createdSubmission = {
            id: 27,
            problem: {
                publicId: 'pa1b2c3d4e5f6',
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        submissionWorkspace.readActiveSourceFile.mockResolvedValue({
            filename: 'main.cpp',
            sourceCode: '#include <iostream>\nint main() { return 0; }\n',
        });
        sessionApi.submitSolution.mockResolvedValue(createdSubmission);
        sessionApi.pollSubmissionResult.mockResolvedValue(null);

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            withProgressNotification,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.submitActiveFile(snapshot.problems[0]);

        expect(sessionApi.pollSubmissionResult).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            context,
            pollIntervalMs: 1500,
            submissionId: 27,
            timeoutMs: 120000,
        });
        expect(treeProvider.setSnapshot).toHaveBeenCalledTimes(1);
        expect(treeProvider.setSnapshot).toHaveBeenCalledWith({
            ...snapshot,
            submissions: [createdSubmission],
        });
        expect(withProgressNotification).toHaveBeenCalledWith(
            'Waiting for the final verdict for submission #27.',
            expect.any(Function)
        );
        expect(showInformationMessage).toHaveBeenCalledWith('Submitted main.cpp to A + B.');
        expect(showInformationMessage).toHaveBeenCalledWith('Submission #27 is still pending. Refresh the explorer later for the final result.');
        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(result).toEqual(createdSubmission);
    });

    it('exports public cases for the selected problem into testcase files', async () => {
        const snapshot = createSnapshot();
        submissionWorkspace.exportPublicCases.mockResolvedValue({
            destinationUri: { fsPath: '/workspace/cases' },
            writtenPairs: [{
                inputUri: { fsPath: '/workspace/cases/prob-a-public-01.in' },
                outputUri: { fsPath: '/workspace/cases/prob-a-public-01.out' },
            }],
        });

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.exportPublicCases(snapshot.problems[0]);

        expect(submissionWorkspace.exportPublicCases).toHaveBeenCalledWith(snapshot.problems[0], [{
            input: '1 2\n',
            output: '3\n',
        }]);
        expect(showInformationMessage).toHaveBeenCalledWith('Exported 1 public testcase pair for A + B.');
        expect(result).toEqual(expect.objectContaining({
            writtenPairs: expect.any(Array),
        }));
    });

    it('exports public cases from top-level API input and output fields', async () => {
        submissionWorkspace.exportPublicCases.mockResolvedValue({
            destinationUri: { fsPath: '/workspace/cases' },
            writtenPairs: [{
                inputUri: { fsPath: '/workspace/cases/prob-a-public-01.in' },
                outputUri: { fsPath: '/workspace/cases/prob-a-public-01.out' },
            }],
        });

        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const selectedProblem = {
            publicId: 'pa1b2c3d4e5f6',
            input: '1 2\n',
            output: '3\n',
            title: 'A + B',
        };

        const result = await controller.exportPublicCases(selectedProblem);

        expect(submissionWorkspace.exportPublicCases).toHaveBeenCalledWith(selectedProblem, [{
            input: '1 2\n',
            output: '3\n',
        }]);
        expect(showInformationMessage).toHaveBeenCalledWith('Exported 1 public testcase pair for A + B.');
        expect(result).toEqual(expect.objectContaining({
            writtenPairs: expect.any(Array),
        }));
    });

    it('shows a concise error when the selected problem has no public cases', async () => {
        const controller = createContestController({
            context,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        const result = await controller.exportPublicCases({
            publicId: 'pa1b2c3d4e5f6',
            title: 'A + B',
        });

        expect(submissionWorkspace.exportPublicCases).not.toHaveBeenCalled();
        expect(showErrorMessage).toHaveBeenCalledWith('No public cases available for A + B.');
        expect(outputChannel.appendLine).toHaveBeenCalledWith('ERROR: No public cases available for A + B.');
        expect(result).toBeNull();
    });

    it('refreshes the standings snapshot on a fixed timer after login without relying on provider-owned snapshot state', async () => {
        vi.useFakeTimers();

        const snapshot = createSnapshot();
        const [ninjas, bits] = snapshot.contest.teams;
        const liveContest = {
            ...snapshot.contest,
            name: 'Regional Final (live)',
            teams: [
                ninjas,
                { ...bits, score: 360000, solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'] },
            ],
        };
        promptTeamCredentials.mockResolvedValue({ password: '123456', teamId: 'k3m9x2p7q8w1a' });
        sessionApi.loginAndLoadContest.mockResolvedValue(snapshot);
        sessionApi.refreshContestDetails.mockResolvedValue(liveContest);
        treeProvider.getSnapshot.mockReturnValue(null);
        openTextDocument.mockResolvedValue({ uri: 'file:///workspace/.autojudge-state/team-details/team-tninjas7f3a00.md' });

        const controller = createContestController({
            context,
            executeCommand,
            openTextDocument,
            outputChannel,
            promptTeamCredentials,
            resolvePollIntervalMs,
            resolveBaseUrl,
            sessionApi,
            setContext,
            showInformationMessage,
            showTextDocument,
            showErrorMessage,
            submissionWorkspace,
            teamsStandingsProvider,
            treeProvider,
        });

        await controller.loginTeam();
        await vi.advanceTimersByTimeAsync(15000);

        expect(sessionApi.refreshContestDetails).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            contest: snapshot.contest,
            context,
        });
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
            contest: liveContest,
        }));

        // Bits now leads the refreshed standings, so Array Ninjas drops to #2 in the preview.
        await controller.openTeamStanding(liveContest.teams[0]);
        expect(fsState.writeFile).toHaveBeenLastCalledWith(
            '/workspace/.autojudge-state/team-details/team-tninjas7f3a00.md',
            expect.any(String),
            { encoding: 'utf-8' }
        );
        const [, content] = fsState.writeFile.mock.calls.at(-1);
        expect(content).toContain('| **🏆 Rank** | **#2** |');
        expect(content).toContain('| **✅ Solved Problems** | 2 / 2 |');

        controller.dispose();
        vi.useRealTimers();
    });
});