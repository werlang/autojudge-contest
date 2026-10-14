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
     * Read the active saved source file that will be submitted.
     * @returns {Promise<{ filename: string, sourceCode: string, uri: import('vscode').Uri }>}
     */
    async readActiveSourceFile() {
        const document = this.requireActiveSourceDocument();

        return {
            filename: path.basename(document.fileName),
            sourceCode: document.getText() || ' ',
            uri: document.uri,
        };
    }

    /**
     * Export public testcase pairs beside the active source file.
     * @param {object} problem
     * @param {{ input: string, output: string }[]} publicCases
     * @returns {Promise<{ destinationUri: import('vscode').Uri, writtenPairs: { inputUri: import('vscode').Uri, outputUri: import('vscode').Uri }[] }>}
     */
    async exportPublicCases(problem, publicCases) {
        const document = this.requireActiveSourceDocument();
        const destinationUri = vscode.Uri.file(path.dirname(document.uri.fsPath));
        await vscode.workspace.fs.createDirectory(destinationUri);

        const writtenPairs = [];
        for (const [index, testcase] of publicCases.entries()) {
            const baseName = `${getProblemTitleStem(problem)}-testcase-${String(index).padStart(2, '0')}`;
            const inputUri = vscode.Uri.file(path.join(destinationUri.fsPath, `${baseName}.in`));
            const outputUri = vscode.Uri.file(path.join(destinationUri.fsPath, `${baseName}.out`));
            await writeUtf8File(inputUri, testcase.input);
            await writeUtf8File(outputUri, testcase.output);
            writtenPairs.push({ inputUri, outputUri });
        }

        return {
            destinationUri,
            writtenPairs,
        };
    }

    /**
     * Require the active editor to point at a saved supported source file.
     * @returns {import('vscode').TextDocument}
     */
    requireActiveSourceDocument() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('Open a saved source file before using contest submissions.');
        }

        const document = editor.document;
        if (document.isUntitled || document.uri.scheme !== 'file') {
            throw new Error('AutoJudge Contest only supports saved files on disk.');
        }

        const extension = path.extname(document.fileName).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
            throw new Error(`Unsupported AutoJudge file extension: ${extension || '(none)'}.`);
        }

        return document;
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