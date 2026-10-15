import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package manifest', () => {
    it('matches submittable file extensions case-insensitively, like the runtime check', () => {
        const submitEntries = manifest.contributes.menus['editor/title']
            .filter(entry => entry.command === 'autojudgeContest.submitActiveFile');

        expect(submitEntries.length).toBeGreaterThan(0);
        for (const entry of submitEntries) {
            const [, pattern, flags] = entry.when.match(/resourceExtname =~ \/(.+)\/([a-z]*)/);
            const regex = new RegExp(pattern, flags);

            expect(regex.test('.cpp')).toBe(true);
            expect(regex.test('.PY')).toBe(true);
            expect(regex.test('.Java')).toBe(true);
            expect(regex.test('.txt')).toBe(false);
        }
    });

    it('describes a rejected attempt as penalty only when the problem is solved later', () => {
        const { markdownDescription } = manifest.contributes.configuration.properties['autojudgeContest.confirmBeforeSubmit'];

        expect(markdownDescription).toContain('adds penalty time only if you solve that problem later');
        expect(markdownDescription).not.toContain('adds a penalty');
    });
});
