import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    mkdir: fsState.mkdir,
    writeFile: fsState.writeFile,
}));

import { ContestPageFiles, resolvePreviewRoot } from '../src/workspace/contest-page-files.js';

const ROOT = '/workspace/.autojudge-state';

describe('ContestPageFiles', () => {
    beforeEach(() => {
        fsState.mkdir.mockReset();
        fsState.writeFile.mockReset();
    });

    it('writes a page under its folder, named after the page', async () => {
        const filePath = await new ContestPageFiles(ROOT).writePage('problem-previews', 'A. A + B', 'problem-x', '# A. A + B');

        expect(filePath).toBe(`${ROOT}/problem-previews/A. A + B.md`);
        expect(fsState.mkdir).toHaveBeenCalledWith(`${ROOT}/problem-previews`, { recursive: true });
        expect(fsState.writeFile).toHaveBeenCalledWith(filePath, '# A. A + B', { encoding: 'utf-8' });
    });

    it('falls back to the fallback name and strips unsafe characters', async () => {
        const pages = new ContestPageFiles(ROOT);

        await expect(pages.writePage('team-details', '   ', 'team-t1', 'x')).resolves.toBe(`${ROOT}/team-details/team-t1.md`);
        await expect(pages.writePage('team-details', 'a/b:c', 'team-t1', 'x')).resolves.toBe(`${ROOT}/team-details/a b c.md`);
    });

    it('writes the expected and received output of a submission', async () => {
        const result = await new ContestPageFiles(ROOT).writeComparison(852, '3\n', undefined);

        expect(result).toEqual({
            expectedPath: `${ROOT}/submission-output/852/expected.txt`,
            receivedPath: `${ROOT}/submission-output/852/received.txt`,
        });
        expect(fsState.mkdir).toHaveBeenCalledWith(`${ROOT}/submission-output/852`, { recursive: true });
        expect(fsState.writeFile).toHaveBeenCalledWith(result.expectedPath, '3\n', { encoding: 'utf-8' });
        expect(fsState.writeFile).toHaveBeenCalledWith(result.receivedPath, '', { encoding: 'utf-8' });
    });
});

describe('resolvePreviewRoot', () => {
    it('prefers workspace storage, then global storage, then the current directory', () => {
        expect(resolvePreviewRoot({ storageUri: { fsPath: '/ws' }, globalStorageUri: { fsPath: '/global' } })).toBe('/ws');
        expect(resolvePreviewRoot({ globalStorageUri: { fsPath: '/global' } })).toBe('/global');
        expect(resolvePreviewRoot(null)).toBe(`${process.cwd()}/.autojudge-contest`);
    });
});
