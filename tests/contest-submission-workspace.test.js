import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => {
    let activeTextEditor = null;
    let workspaceFolders;

    return {
        createDirectory: vi.fn(),
        readDirectory: vi.fn(),
        stat: vi.fn(),
        writeFile: vi.fn(),
        showOpenDialog: vi.fn(),
        getActiveTextEditor() {
            return activeTextEditor;
        },
        getWorkspaceFolders() {
            return workspaceFolders;
        },
        setActiveTextEditor(editor) {
            activeTextEditor = editor;
        },
        setWorkspaceFolders(folders) {
            workspaceFolders = folders;
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
        showOpenDialog: vscodeState.showOpenDialog,
    },
    workspace: {
        get workspaceFolders() {
            return vscodeState.getWorkspaceFolders();
        },
        fs: {
            createDirectory: vscodeState.createDirectory,
            readDirectory: vscodeState.readDirectory,
            stat: vscodeState.stat,
            writeFile: vscodeState.writeFile,
        },
    },
}), { virtual: true });

import { ContestSubmissionWorkspace } from '../src/workspace/contest-submission-workspace.js';

function createActiveEditor(filePath, { isDirty = false, scheme = 'file', isUntitled = false } = {}) {
    const normalizedPath = path.normalize(filePath);

    return {
        document: {
            fileName: normalizedPath,
            getText: () => '#include <iostream>\n',
            isDirty,
            isUntitled,
            uri: {
                fsPath: normalizedPath,
                scheme,
            },
        },
    };
}

function folder(fsPath) {
    return { uri: { fsPath: path.normalize(fsPath), scheme: 'file' } };
}

function getWrittenText(callIndex) {
    return Buffer.from(vscodeState.writeFile.mock.calls[callIndex][1]).toString('utf8');
}

const problem = { publicId: 'pa1b2c3d4e5f6', title: 'Prob A' };
const srcDir = { fsPath: path.normalize('/workspace/src'), scheme: 'file' };

describe('contest submission workspace', () => {
    beforeEach(() => {
        vscodeState.createDirectory.mockReset();
        vscodeState.writeFile.mockReset();
        vscodeState.stat.mockReset();
        vscodeState.showOpenDialog.mockReset();
        vscodeState.setWorkspaceFolders(undefined);
        vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/main.cpp'));
    });

    describe('readActiveSourceFile', () => {
        it('returns the file details and a clean dirty flag', async () => {
            const result = await new ContestSubmissionWorkspace().readActiveSourceFile();

            expect(result.filename).toBe('main.cpp');
            expect(result.sourceCode).toBe('#include <iostream>\n');
            expect(result.isDirty).toBe(false);
            expect(result.uri).toBe(result.document.uri);
        });

        it('reports unsaved buffers as dirty', async () => {
            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/main.py', { isDirty: true }));

            const result = await new ContestSubmissionWorkspace().readActiveSourceFile();

            expect(result.isDirty).toBe(true);
        });

        it('asks to open a solution file when there is no editor', async () => {
            vscodeState.setActiveTextEditor(null);

            await expect(new ContestSubmissionWorkspace().readActiveSourceFile())
                .rejects.toThrow('Open the solution file you want to submit.');
        });

        it('asks to save files that are not on disk', async () => {
            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/main.cpp', { isUntitled: true }));
            await expect(new ContestSubmissionWorkspace().readActiveSourceFile())
                .rejects.toThrow('Save the file to disk before submitting.');

            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/main.cpp', { scheme: 'vscode-remote' }));
            await expect(new ContestSubmissionWorkspace().readActiveSourceFile())
                .rejects.toThrow('Save the file to disk before submitting.');
        });

        it('lists supported extensions for unsupported files', async () => {
            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/notes.txt'));
            await expect(new ContestSubmissionWorkspace().readActiveSourceFile())
                .rejects.toThrow("AutoJudge can't judge .txt. Supported: .c, .cpp, .java, .js, .php, .py.");

            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/Makefile'));
            await expect(new ContestSubmissionWorkspace().readActiveSourceFile())
                .rejects.toThrow("AutoJudge can't judge files without an extension. Supported: .c, .cpp, .java, .js, .php, .py.");
        });
    });

    describe('readSourceDocument', () => {
        it('reads the given document even when another editor is active', () => {
            const saved = createActiveEditor('/workspace/src/main.cpp').document;
            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/src/other.py'));

            const result = new ContestSubmissionWorkspace().readSourceDocument(saved);

            expect(result.filename).toBe('main.cpp');
            expect(result.document).toBe(saved);
        });

        it('sends an empty document as a single space', () => {
            const empty = { ...createActiveEditor('/workspace/src/main.cpp').document, getText: () => '' };

            expect(new ContestSubmissionWorkspace().readSourceDocument(empty).sourceCode).toBe(' ');
        });
    });

    describe('getActiveFileDirectory', () => {
        it('returns the directory of any on-disk active document', () => {
            vscodeState.setActiveTextEditor(createActiveEditor('/workspace/docs/statement.md'));

            expect(new ContestSubmissionWorkspace().getActiveFileDirectory())
                .toEqual(expect.objectContaining({ fsPath: path.normalize('/workspace/docs') }));
        });

        it('returns null without an editor or for non-file documents', () => {
            const workspace = new ContestSubmissionWorkspace();
            vscodeState.setActiveTextEditor(null);
            expect(workspace.getActiveFileDirectory()).toBeNull();

            vscodeState.setActiveTextEditor(createActiveEditor('/x/y.md', { scheme: 'untitled', isUntitled: true }));
            expect(workspace.getActiveFileDirectory()).toBeNull();
        });
    });

    describe('pickExportDirectory', () => {
        it('prefers the active file directory without prompting', async () => {
            vscodeState.setWorkspaceFolders([folder('/other')]);

            const result = await new ContestSubmissionWorkspace().pickExportDirectory();

            expect(result).toEqual(expect.objectContaining({ fsPath: path.normalize('/workspace/src') }));
            expect(vscodeState.showOpenDialog).not.toHaveBeenCalled();
        });

        it('falls back to the single workspace folder', async () => {
            vscodeState.setActiveTextEditor(null);
            const only = folder('/only');
            vscodeState.setWorkspaceFolders([only]);

            const result = await new ContestSubmissionWorkspace().pickExportDirectory();

            expect(result).toBe(only.uri);
            expect(vscodeState.showOpenDialog).not.toHaveBeenCalled();
        });

        it('opens a folder dialog defaulting to the first of several workspace folders', async () => {
            vscodeState.setActiveTextEditor(null);
            const first = folder('/one');
            vscodeState.setWorkspaceFolders([first, folder('/two')]);
            const chosen = { fsPath: '/chosen', scheme: 'file' };
            vscodeState.showOpenDialog.mockResolvedValue([chosen]);

            const result = await new ContestSubmissionWorkspace().pickExportDirectory();

            expect(result).toBe(chosen);
            expect(vscodeState.showOpenDialog).toHaveBeenCalledWith({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Export Here',
                title: 'Choose where to save the public test cases',
                defaultUri: first.uri,
            });
        });

        it('opens the dialog without a default when no folder is open and returns undefined on cancel', async () => {
            vscodeState.setActiveTextEditor(null);
            vscodeState.showOpenDialog.mockResolvedValue(undefined);

            const result = await new ContestSubmissionWorkspace().pickExportDirectory();

            expect(result).toBeUndefined();
            expect(vscodeState.showOpenDialog.mock.calls[0][0]).not.toHaveProperty('defaultUri');
        });
    });

    describe('case files', () => {
        it('builds 1-based two-digit .in/.out targets', () => {
            const targets = new ContestSubmissionWorkspace().getCaseFileUris(problem, 2, srcDir);

            expect(targets.map(({ inputUri, outputUri }) => [inputUri.fsPath, outputUri.fsPath])).toEqual([
                [path.join(srcDir.fsPath, 'prob-a-testcase-01.in'), path.join(srcDir.fsPath, 'prob-a-testcase-01.out')],
                [path.join(srcDir.fsPath, 'prob-a-testcase-02.in'), path.join(srcDir.fsPath, 'prob-a-testcase-02.out')],
            ]);
        });

        it('names blank-titled problems by public id so their testcases do not collide', () => {
            const [target] = new ContestSubmissionWorkspace().getCaseFileUris({ publicId: 'pa1b2c3d4e5f6', title: '   ' }, 1, srcDir);

            expect(target.inputUri.fsPath).toBe(path.join(srcDir.fsPath, 'problem-pa1b2c3d4e5f6-testcase-01.in'));
        });

        it('reports only targets that already exist', async () => {
            vscodeState.stat.mockImplementation(async uri => {
                if (uri.fsPath.endsWith('prob-a-testcase-02.out') || uri.fsPath.endsWith('prob-a-testcase-01.in')) {
                    return { type: 1 };
                }
                throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
            });

            const existing = await new ContestSubmissionWorkspace().findExistingCaseFiles(problem, 2, srcDir);

            expect(existing.map(uri => uri.fsPath)).toEqual([
                path.join(srcDir.fsPath, 'prob-a-testcase-01.in'),
                path.join(srcDir.fsPath, 'prob-a-testcase-02.out'),
            ]);
        });

        it('reports nothing when no target exists', async () => {
            vscodeState.stat.mockRejectedValue(new Error('nope'));

            expect(await new ContestSubmissionWorkspace().findExistingCaseFiles(problem, 3, srcDir)).toEqual([]);
        });
    });

    describe('exportPublicCases', () => {
        it('writes 1-based .in/.out files into the given directory', async () => {
            const workspace = new ContestSubmissionWorkspace();

            const result = await workspace.exportPublicCases(
                problem,
                [
                    { input: '1 2\n', output: '3\n' },
                    { input: '4 5\n', output: '9\n' },
                ],
                { directoryUri: srcDir },
            );

            expect(vscodeState.createDirectory).toHaveBeenCalledWith(srcDir);
            expect(vscodeState.writeFile.mock.calls.map(([uri]) => uri.fsPath)).toEqual([
                path.join(srcDir.fsPath, 'prob-a-testcase-01.in'),
                path.join(srcDir.fsPath, 'prob-a-testcase-01.out'),
                path.join(srcDir.fsPath, 'prob-a-testcase-02.in'),
                path.join(srcDir.fsPath, 'prob-a-testcase-02.out'),
            ]);
            expect(getWrittenText(0)).toBe('1 2\n');
            expect(getWrittenText(1)).toBe('3\n');
            expect(getWrittenText(2)).toBe('4 5\n');
            expect(getWrittenText(3)).toBe('9\n');
            expect(result.destinationUri).toBe(srcDir);
            expect(result.writtenPairs.map(pair => path.basename(pair.inputUri.fsPath))).toEqual([
                'prob-a-testcase-01.in',
                'prob-a-testcase-02.in',
            ]);
        });

        it('exports even with no active editor', async () => {
            vscodeState.setActiveTextEditor(null);

            await new ContestSubmissionWorkspace().exportPublicCases(
                problem,
                [{ input: 'a', output: 'b' }],
                { directoryUri: srcDir },
            );

            expect(vscodeState.writeFile).toHaveBeenCalledTimes(2);
        });

        it('requires a destination directory', async () => {
            await expect(new ContestSubmissionWorkspace().exportPublicCases(problem, [{ input: 'a', output: 'b' }]))
                .rejects.toThrow('Choose a folder to export the public test cases to.');
            expect(vscodeState.writeFile).not.toHaveBeenCalled();
        });
    });
});
