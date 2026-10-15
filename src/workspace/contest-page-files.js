import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toSafeFileName } from '../presentation/contest-presentation.js';

/**
 * Resolve the storage root used for generated pages and output files: the
 * workspace storage, then the global storage, then `.autojudge-contest` under
 * the current directory.
 * @param {{ storageUri?: { fsPath: string }, globalStorageUri?: { fsPath: string } } | null | undefined} context
 * @returns {string}
 */
export function resolvePreviewRoot(context) {
    return context?.storageUri?.fsPath
        ?? context?.globalStorageUri?.fsPath
        ?? join(process.cwd(), '.autojudge-contest');
}

/**
 * Own the generated files under the extension storage root: Markdown pages
 * (problem, submission, team, contest) and the expected/received output pair
 * used by Compare Output.
 */
export class ContestPageFiles {
    /**
     * @param {string} storageRoot directory every generated file lives under
     */
    constructor(storageRoot) {
        this.storageRoot = storageRoot;
    }

    /**
     * Write a Markdown page to `<root>/<folder>/<safe page name>.md`, creating
     * the folder when needed.
     * @param {string} folder per-kind subfolder
     * @param {string} pageName page name, also the file name so the preview tab reads it
     * @param {string} fallbackName file name when the page name is unusable
     * @param {string} content
     * @returns {Promise<string>} the written file path
     */
    async writePage(folder, pageName, fallbackName, content) {
        const directory = join(this.storageRoot, folder);
        const filePath = join(directory, `${toSafeFileName(pageName, fallbackName)}.md`);

        await mkdir(directory, { recursive: true });
        await writeFile(filePath, content, { encoding: 'utf-8' });
        return filePath;
    }

    /**
     * Write a submission's expected and received output to
     * `<root>/submission-output/<id>/expected.txt` and `received.txt`.
     * @param {number | string | null | undefined} submissionId
     * @param {unknown} expected
     * @param {unknown} received
     * @returns {Promise<{ expectedPath: string, receivedPath: string }>}
     */
    async writeComparison(submissionId, expected, received) {
        const directory = join(
            this.storageRoot,
            'submission-output',
            toSafeFileName(String(submissionId ?? ''), 'unknown'),
        );
        const expectedPath = join(directory, 'expected.txt');
        const receivedPath = join(directory, 'received.txt');

        await mkdir(directory, { recursive: true });
        await writeFile(expectedPath, String(expected ?? ''), { encoding: 'utf-8' });
        await writeFile(receivedPath, String(received ?? ''), { encoding: 'utf-8' });
        return { expectedPath, receivedPath };
    }
}
