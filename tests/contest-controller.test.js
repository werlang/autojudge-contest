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

function createSnapshot() {
    const contest = {
        id: 4,
        name: 'Regional Final',
        problems: [
            { id: 1, order: 1, title: 'A + B' },
            { id: 2, order: 2, title: 'Binary Search' },
        ],
        teams: [
            {
                id: 12,
                name: 'Array Ninjas',
                score: 350000,
                solvedProblems: [1, 2],
            },
            {
                id: 9,
                name: 'Bits',
                score: 200000,
                solvedProblems: [1],
            },
        ],
    };

    return {
        problems: [{
            id: 1,
            hash: 'prob-a',
            input: ['1 2\n'],
            output: ['3\n'],
            title: 'A + B',
        }],
        submissions: [],
        team: {
            contest,
            name: 'Bits',
        },
        contest,
        token: 'team-jwt-token',
    };
}

/**
 * Build a snapshot whose payload carries only public keys, the shape newer
 * servers send: publicId on contests and problems, solvedProblemIds and
 * scoreboardId on teams, and no numeric ids anywhere.
 * @returns {object}
 */
function createPublicIdSnapshot() {
    const problems = [
        { publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B' },
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
                scoreboardId: 'sb-ninjas-7f3a',
                score: 350000,
                solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
            },
            {
                name: 'Bits',
                scoreboardId: 'sb-bits-91cd',
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
            scoreboardId: 'sb-bits-91cd',
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
        promptTeamCredentials.mockResolvedValue({ password: '123456', teamId: 'teamhash9' });
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
            teamId: 'teamhash9',
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
            hash: 'prob-a',
            id: 1,
            order: 1,
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
        const document = { uri: 'file:///workspace/.autojudge-state/contest-dashboards/contest-4.md' };
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
            id: 4,
            name: 'Regional Final',
            duration: 180,
            startTime: '2026-05-28T03:00:00.000Z',
        };

        const result = await controller.openContestDashboard(contest);

        expect(fsState.mkdir).toHaveBeenCalledWith('/workspace/.autojudge-state/contest-dashboards', {
            recursive: true,
        });
        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/contest-dashboards/contest-4.md',
            expect.stringContaining('# 🏆 Contest Dashboard: Regional Final'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/contest-dashboards/contest-4.md');
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
            problem: { id: 1, title: 'A + B' },
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
        const document = { uri: 'file:///workspace/.autojudge-state/team-details/team-12.md' };
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
            '/workspace/.autojudge-state/team-details/team-12.md',
            expect.stringContaining('# 👥 Team Standing: Array Ninjas'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/team-details/team-12.md');
        expect(executeCommand).toHaveBeenCalledWith('markdown.showPreview', document.uri, expect.any(Object));
        expect(result).toEqual(team);
    });

    it('names the contest dashboard preview by public id when the server omits numeric ids', async () => {
        const snapshot = createPublicIdSnapshot();
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

        await controller.openContestDashboard(snapshot.contest);

        expect(fsState.writeFile).toHaveBeenCalledWith(
            '/workspace/.autojudge-state/contest-dashboards/contest-k3m9x2p7q8w1a.md',
            expect.stringContaining('# 🏆 Contest Regional Final'),
            { encoding: 'utf-8' }
        );
        expect(openTextDocument).toHaveBeenCalledWith('/workspace/.autojudge-state/contest-dashboards/contest-k3m9x2p7q8w1a.md');
    });

    it('names the team standing preview by scoreboard id and ranks it from public-id standings', async () => {
        const snapshot = createPublicIdSnapshot();
        treeProvider.getSnapshot.mockReturnValue(snapshot);
        openTextDocument.mockResolvedValue({ uri: 'file:///workspace/.autojudge-state/team-details/team-sb-bits-91cd.md' });

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
            '/workspace/.autojudge-state/team-details/team-sb-bits-91cd.md',
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
                id: 1,
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
            problemId: 1,
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
        const snapshot = createPublicIdSnapshot();
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
                id: 1,
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        const finalSubmission = {
            id: 27,
            problem: {
                id: 1,
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
                id: 1,
                title: 'A + B',
            },
            status: 'PENDING',
            submittedAt: '2026-05-28T04:00:00.000Z',
        };
        const finalSubmission = {
            id: 27,
            problem: {
                id: 1,
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
                id: 1,
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
            id: 1,
            hash: 'prob-a',
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
            id: 1,
            hash: 'prob-a',
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
        const refreshedContest = {
            ...snapshot.contest,
            teams: [
                {
                    id: 12,
                    name: 'Array Ninjas',
                    score: 360,
                    problems: [
                        { id: 1, order: 1, solved: true, title: 'A + B' },
                        { id: 2, order: 2, solved: true, title: 'Binary Search' },
                    ],
                },
            ],
        };
        const refreshedSnapshot = {
            ...snapshot,
            team: {
                ...snapshot.team,
            },
            contest: refreshedContest,
        };
        promptTeamCredentials.mockResolvedValue({ password: '123456', teamId: 'teamhash9' });
        sessionApi.loginAndLoadContest.mockResolvedValue(snapshot);
        sessionApi.refreshContestDetails.mockResolvedValue(refreshedContest);
        treeProvider.getSnapshot.mockReturnValue(null);

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

        await controller.loginTeam();
        await vi.advanceTimersByTimeAsync(15000);

        expect(sessionApi.refreshContestDetails).toHaveBeenCalledWith({
            baseUrl: 'https://api.autojudge.test',
            contest: snapshot.team.contest,
            context,
        });
        expect(teamsStandingsProvider.setSnapshot).toHaveBeenLastCalledWith(refreshedSnapshot);

        controller.dispose();
        vi.useRealTimers();
    });

    it('keeps refreshing standings when the contest is identified only by its public id', async () => {
        vi.useFakeTimers();

        const snapshot = createPublicIdSnapshot();
        const [ninjas, bits] = snapshot.contest.teams;
        const liveContest = {
            ...snapshot.contest,
            name: 'Regional Final (live)',
            teams: [
                ninjas,
                { ...bits, score: 360000, solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'] },
            ],
        };
        promptTeamCredentials.mockResolvedValue({ password: '123456', teamId: 'teamhash9' });
        sessionApi.loginAndLoadContest.mockResolvedValue(snapshot);
        sessionApi.refreshContestDetails.mockResolvedValue(liveContest);
        treeProvider.getSnapshot.mockReturnValue(null);
        openTextDocument.mockResolvedValue({ uri: 'file:///workspace/.autojudge-state/team-details/team-sb-ninjas-7f3a.md' });

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
            '/workspace/.autojudge-state/team-details/team-sb-ninjas-7f3a.md',
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