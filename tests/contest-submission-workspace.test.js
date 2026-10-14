import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => {
    let activeTextEditor = null;
    let testcasePath = '';

    return {
        createDirectory: vi.fn(),
        readDirectory: vi.fn(),
        writeFile: vi.fn(),
        getActiveTextEditor() {
            return activeTextEditor;
        },
        getTestcasePath() {
            return testcasePath;
        },
        setActiveTextEditor(editor) {
            activeTextEditor = editor;
        },
        setTestcasePath(value) {
            testcasePath = value;
        },
    };
});

vi.mock('vscode', () => ({
    FileType: {
        File: 1,
        Directory: 2,
    },
    Uri: {
        file: fsPath => ({
            fsPath: path.normalize(fsPath),
            scheme: 'file',
        }),
    },
    window: {
        get activeTextEditor() {
            return vscodeState.getActiveTextEditor();
        },
    },
    workspace: {
        fs: {
            createDirectory: vscodeState.createDirectory,
            readDirectory: vscodeState.readDirectory,
            writeFile: vscodeState.writeFile,
        },
        getConfiguration: () => ({
            get: (_key, fallbackValue = '') => {
                const value = vscodeState.getTestcasePath();
                return value === '' ? fallbackValue : value;
            },
        }),
    },
}), { virtual: true });

import { ContestSubmissionWorkspace } from '../src/workspace/contest-submission-workspace.js';

function createActiveEditor(filePath) {
    const normalizedPath = path.normalize(filePath);

    return {
        document: {
            fileName: normalizedPath,
            getText: () => '#include <iostream>\n',
            isUntitled: false,
            uri: {
                fsPath: normalizedPath,
                scheme: 'file',
            },
        },
    };
}

function getWrittenText(callIndex) {
    return Buffer.from(vscodeState.writeFile.mock.calls[callIndex][1]).toString('utf8');
}

describe('contest submission workspace', () => {
    beforeEach(() => {
        vscodeState.createDirectory.mockReset();
        vscodeState.writeFile.mockReset();
        vscodeState.setTestcasePath('');
        vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/main.cpp'));
    });

    it('exports public cases as numbered .in/.out files in the active file directory by default', async () => {
        const workspace = new ContestSubmissionWorkspace();

        const result = await workspace.exportPublicCases(
            { publicId: 'pa1b2c3d4e5f6', title: 'Prob A' },
            [
                { input: '1 2\n', output: '3\n' },
                { input: '4 5\n', output: '9\n' },
            ],
        );

        const destinationPath = path.normalize('/workspace/src');
        expect(vscodeState.createDirectory).toHaveBeenCalledWith(expect.objectContaining({
            fsPath: destinationPath,
        }));
        expect(vscodeState.writeFile.mock.calls.map(([uri]) => uri.fsPath)).toEqual([
            path.join(destinationPath, 'prob-a-testcase-00.in'),
            path.join(destinationPath, 'prob-a-testcase-00.out'),
            path.join(destinationPath, 'prob-a-testcase-01.in'),
            path.join(destinationPath, 'prob-a-testcase-01.out'),
        ]);
        expect(getWrittenText(0)).toBe('1 2\n');
        expect(getWrittenText(1)).toBe('3\n');
        expect(getWrittenText(2)).toBe('4 5\n');
        expect(getWrittenText(3)).toBe('9\n');
        expect(result).toEqual({
            destinationUri: expect.objectContaining({ fsPath: destinationPath }),
            writtenPairs: [
                {
                    inputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-00.in') }),
                    outputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-00.out') }),
                },
                {
                    inputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-01.in') }),
                    outputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-01.out') }),
                },
            ],
        });
    });

    it('names blank-titled problems by public id so their exported testcases do not collide', async () => {
        const workspace = new ContestSubmissionWorkspace();

        await workspace.exportPublicCases(
            { publicId: 'pa1b2c3d4e5f6', title: '   ' },
            [{ input: '1 2\n', output: '3\n' }],
        );

        const destinationPath = path.normalize('/workspace/src');
        expect(vscodeState.writeFile.mock.calls.map(([uri]) => uri.fsPath)).toEqual([
            path.join(destinationPath, 'problem-pa1b2c3d4e5f6-testcase-00.in'),
            path.join(destinationPath, 'problem-pa1b2c3d4e5f6-testcase-00.out'),
        ]);
    });

    it('exports public cases beside the active source file even when a testcase path is configured', async () => {
        vscodeState.setTestcasePath('../cases');

        const workspace = new ContestSubmissionWorkspace();

        const result = await workspace.exportPublicCases(
            { publicId: 'pa1b2c3d4e5f6', title: 'Prob A' },
            [
                { input: '1 2\n', output: '3\n' },
            ],
        );

        const destinationPath = path.normalize('/workspace/src');
        expect(vscodeState.createDirectory).toHaveBeenCalledWith(expect.objectContaining({
            fsPath: destinationPath,
        }));
        expect(vscodeState.writeFile.mock.calls.map(([uri]) => uri.fsPath)).toEqual([
            path.join(destinationPath, 'prob-a-testcase-00.in'),
            path.join(destinationPath, 'prob-a-testcase-00.out'),
        ]);
        expect(result).toEqual({
            destinationUri: expect.objectContaining({ fsPath: destinationPath }),
            writtenPairs: [
                {
                    inputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-00.in') }),
                    outputUri: expect.objectContaining({ fsPath: path.join(destinationPath, 'prob-a-testcase-00.out') }),
                },
            ],
        });
    });
});