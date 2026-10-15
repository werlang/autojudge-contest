import path from 'path';
import * as vscode from 'vscode';
import { SUPPORTED_EXTENSIONS } from '../utils/config.js';
import { resolveRouteId } from '../utils/public-id.js';

const textEncoder = new TextEncoder();

/**
 * Own workspace-facing file and editor behavior for contest submissions and
 * testcase-file workflows.
 */
export class ContestSubmissionWorkspace {
    /**
     * Read the active on-disk source file that will be submitted.
     * @returns {Promise<{ filename: string, sourceCode: string, uri: import('vscode').Uri, document: import('vscode').TextDocument, isDirty: boolean }>}
     *   `isDirty` is true when the editor buffer has unsaved changes, so callers can offer to save first.
     */
    async readActiveSourceFile() {
        return this.readSourceDocument(this.requireActiveSourceDocument());
    }

    /**
     * Read a given source document, e.g. the one just saved, whatever editor is
     * active now. An empty file is sent as a single space, which the judge
     * accepts where it refuses an empty body.
     * @param {import('vscode').TextDocument} document
     * @returns {{ filename: string, sourceCode: string, uri: import('vscode').Uri, document: import('vscode').TextDocument, isDirty: boolean }}
     */
    readSourceDocument(document) {
        return {
            filename: path.basename(document.fileName),
            sourceCode: document.getText() || ' ',
            uri: document.uri,
            document,
            isDirty: Boolean(document.isDirty),
        };
    }

    /**
     * Get the directory of the active text editor's document when it lives on disk.
     * Any file extension qualifies, so a focused Markdown preview source still works.
     * @returns {import('vscode').Uri | null}
     */
    getActiveFileDirectory() {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.isUntitled || document.uri?.scheme !== 'file') {
            return null;
        }

        return vscode.Uri.file(path.dirname(document.uri.fsPath));
    }

    /**
     * Resolve where public testcases should be exported: the active file directory,
     * then the only workspace folder, then a folder chosen in an open dialog.
     * @returns {Promise<import('vscode').Uri | undefined>} `undefined` when the dialog is cancelled.
     */
    async pickExportDirectory() {
        const activeDirectory = this.getActiveFileDirectory();
        if (activeDirectory) {
            return activeDirectory;
        }

        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 1) {
            return folders[0].uri;
        }

        const options = {
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Export Here',
            title: 'Choose where to save the public test cases',
        };
        if (folders.length > 1) {
            options.defaultUri = folders[0].uri;
        }

        const picked = await vscode.window.showOpenDialog(options);
        return picked?.[0];
    }

    /**
     * Build the `.in`/`.out` target URIs for a problem's public cases, numbered from 01.
     * @param {object} problem
     * @param {number} caseCount
     * @param {import('vscode').Uri} directoryUri
     * @returns {{ inputUri: import('vscode').Uri, outputUri: import('vscode').Uri }[]}
     */
    getCaseFileUris(problem, caseCount, directoryUri) {
        const stem = getProblemTitleStem(problem);
        const count = Math.max(0, Math.floor(Number(caseCount) || 0));

        return Array.from({ length: count }, (_unused, index) => {
            const baseName = `${stem}-testcase-${String(index + 1).padStart(2, '0')}`;
            return {
                inputUri: vscode.Uri.file(path.join(directoryUri.fsPath, `${baseName}.in`)),
                outputUri: vscode.Uri.file(path.join(directoryUri.fsPath, `${baseName}.out`)),
            };
        });
    }

    /**
     * List export targets that already exist so callers can ask before overwriting.
     * Any stat failure (including FileNotFound) counts as "does not exist".
     * @param {object} problem
     * @param {number} caseCount
     * @param {import('vscode').Uri} directoryUri
     * @returns {Promise<import('vscode').Uri[]>}
     */
    async findExistingCaseFiles(problem, caseCount, directoryUri) {
        const existing = [];
        for (const { inputUri, outputUri } of this.getCaseFileUris(problem, caseCount, directoryUri)) {
            for (const uri of [inputUri, outputUri]) {
                if (await uriExists(uri)) {
                    existing.push(uri);
                }
            }
        }

        return existing;
    }

    /**
     * Export public testcase pairs into the given directory, creating it if needed.
     * Does not consult the active editor and overwrites existing targets; callers
     * should check `findExistingCaseFiles` first.
     * @param {object} problem
     * @param {{ input: string, output: string }[]} publicCases
     * @param {{ directoryUri: import('vscode').Uri }} options
     * @returns {Promise<{ destinationUri: import('vscode').Uri, writtenPairs: { inputUri: import('vscode').Uri, outputUri: import('vscode').Uri }[] }>}
     */
    async exportPublicCases(problem, publicCases, { directoryUri } = {}) {
        if (!directoryUri) {
            throw new Error('Choose a folder to export the public test cases to.');
        }

        await vscode.workspace.fs.createDirectory(directoryUri);

        const targets = this.getCaseFileUris(problem, publicCases.length, directoryUri);
        const writtenPairs = [];
        for (const [index, testcase] of publicCases.entries()) {
            const { inputUri, outputUri } = targets[index];
            await writeUtf8File(inputUri, testcase.input);
            await writeUtf8File(outputUri, testcase.output);
            writtenPairs.push({ inputUri, outputUri });
        }

        return {
            destinationUri: directoryUri,
            writtenPairs,
        };
    }

    /**
     * Require the active editor to point at an on-disk supported source file.
     * @returns {import('vscode').TextDocument}
     * @throws {Error} With a user-facing message naming the supported extensions when unsupported.
     */
    requireActiveSourceDocument() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('Open the solution file you want to submit.');
        }

        const document = editor.document;
        if (document.isUntitled || document.uri.scheme !== 'file') {
            throw new Error('Save the file to disk before submitting.');
        }

        const extension = path.extname(document.fileName).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
            const label = extension || 'files without an extension';
            throw new Error(`AutoJudge can't judge ${label}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`);
        }

        return document;
    }
}

/**
 * Check whether a URI exists on the file system.
 * @param {import('vscode').Uri} uri
 * @returns {Promise<boolean>}
 */
async function uriExists(uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write UTF-8 text to a workspace file.
 * @param {import('vscode').Uri} uri
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeUtf8File(uri, content) {
    await vscode.workspace.fs.writeFile(uri, textEncoder.encode(content));
}

/**
 * Get a safe string from a problem title to use as a filename stem. Blank titles
 * fall back to the problem route id so exports from different problems never share a name.
 * @param {object} problem
 * @returns {string}
 */
function getProblemTitleStem(problem) {
    const routeId = resolveRouteId(problem) ?? 'unknown';
    const rawTitle = problem?.title?.toString().trim() || `problem-${routeId}`;
    // replace accents and non-alphanumeric characters their closest ASCII equivalent, then replace remaining non-alphanumerics with dashes, and trim extra dashes from the ends
    const replaceDiacritics = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedTitle = rawTitle
        .toLowerCase()
        .split('')
        .map(char => replaceDiacritics(char))
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalizedTitle || `problem-${routeId}`;
}