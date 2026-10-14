import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    ThemeColor: class ThemeColor {
        constructor(id) {
            this.id = id;
        }
    },
    ThemeIcon: class ThemeIcon {
        constructor(id, color) {
            this.id = id;
            this.color = color;
        }
    },
    Uri: {
        parse: (value) => ({
            toString: () => value,
            fsPath: value,
        }),
    },
}), { virtual: true });

import { ContestTreeProvider } from '../src/providers/contest-tree-provider.js';
import { COMMANDS, TREE_CONTEXT } from '../src/constants.js';

describe('contest tree provider', () => {
    it('returns an empty tree while no contest snapshot is loaded so the welcome action can render', () => {
        const provider = new ContestTreeProvider();

        expect(provider.getChildren()).toEqual([]);
    });

    it('renders the contest header, problems, and per-problem submissions after login', () => {
        const provider = new ContestTreeProvider();

        provider.setSnapshot({
            problems: [
                { publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B' },
                { publicId: 'pb2c3d4e5f6a1', order: 2, title: 'Binary Search' },
            ],
            submissions: [
                {
                    id: 11,
                    status: 'WRONG_ANSWER',
                    submittedAt: '2026-05-28T03:00:00.000Z',
                    problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                },
                {
                    id: 12,
                    status: 'ACCEPTED',
                    submittedAt: '2026-05-28T03:10:00.000Z',
                    problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                },
            ],
            team: {
                contest: {
                    publicId: 'k3m9x2p7q8w1a',
                    name: 'Regional Final',
                },
                name: 'Bits',
            },
            contest: {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
            },
            token: 'jwt-token',
        });

        const rootChildren = provider.getChildren();

        expect(rootChildren).toEqual([
            expect.objectContaining({
                description: 'Bits',
                iconPath: expect.objectContaining({
                    id: 'mortar-board',
                }),
                label: 'REGIONAL FINAL',
            }),
            expect.objectContaining({
                contextValue: TREE_CONTEXT.PROBLEM,
                description: '2 submissions',
                label: 'A + B',
            }),
            expect.objectContaining({
                contextValue: TREE_CONTEXT.PROBLEM,
                description: '0 submissions',
                label: 'Binary Search',
            }),
        ]);

        expect(rootChildren[1].command).toBeUndefined();

        const problemChildren = provider.getChildren(rootChildren[1]);
        expect(problemChildren).toEqual([
            expect.objectContaining({
                command: expect.objectContaining({
                    command: COMMANDS.OPEN_SUBMISSION,
                }),
                contextValue: TREE_CONTEXT.SUBMISSION,
                description: 'Accepted',
                iconPath: expect.objectContaining({
                    color: expect.objectContaining({
                        id: 'testing.iconPassed',
                    }),
                    id: 'pass-filled',
                }),
                label: '#12',
            }),
            expect.objectContaining({
                description: 'Wrong Answer',
                iconPath: expect.objectContaining({
                    color: expect.objectContaining({
                        id: 'testing.iconFailed',
                    }),
                    id: 'error',
                }),
                label: '#11',
            }),
        ]);
    });

    it('groups submissions by problem public id', () => {
        const provider = new ContestTreeProvider();

        provider.setSnapshot({
            problems: [
                { publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B' },
                { publicId: 'pb2c3d4e5f6a1', order: 2, title: 'Binary Search' },
            ],
            submissions: [
                {
                    id: 11,
                    status: 'WRONG_ANSWER',
                    submittedAt: '2026-05-28T03:00:00.000Z',
                    problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                },
                {
                    id: 12,
                    status: 'ACCEPTED',
                    submittedAt: '2026-05-28T03:10:00.000Z',
                    problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' },
                },
                {
                    id: 13,
                    status: 'ACCEPTED',
                    submittedAt: '2026-05-28T03:20:00.000Z',
                    problem: { title: 'Orphaned' },
                },
            ],
            team: {
                contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                name: 'Bits',
            },
            contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
            token: 'jwt-token',
        });

        const rootChildren = provider.getChildren();

        expect(rootChildren[1]).toEqual(expect.objectContaining({ description: '2 submissions', label: 'A + B' }));
        expect(rootChildren[2]).toEqual(expect.objectContaining({ description: '0 submissions', label: 'Binary Search' }));
        expect(provider.getChildren(rootChildren[1]).map(child => child.label)).toEqual(['#12', '#11']);
        expect(provider.getChildren(rootChildren[2])).toEqual([]);
    });

    it('sets the snapshot and renders the contest header without countdown tickers', () => {
        const provider = new ContestTreeProvider();
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        provider.setSnapshot({
            problems: [],
            submissions: [],
            team: {
                contest: {
                    publicId: 'k3m9x2p7q8w1a',
                    name: 'Regional Final',
                },
                name: 'Bits',
            },
            contest: {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
            },
            token: 'jwt-token',
        });

        const rootChildren = provider.getChildren();
        expect(rootChildren[0].description).toBe('Bits');
        expect(rootChildren[0].tooltip).toBe('Regional Final\nBits');
        expect(listener).toHaveBeenCalledTimes(1);

        provider.dispose();
    });

    it('shows a not-started note instead of problems while the contest has not started', () => {
        const provider = new ContestTreeProvider();

        provider.setSnapshot({
            problems: [],
            contestNotStarted: true,
            submissions: [],
            team: { name: 'Bits', contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' } },
            contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
            token: 'jwt-token',
        });

        const rootChildren = provider.getChildren();

        expect(rootChildren).toEqual([
            expect.objectContaining({ label: 'REGIONAL FINAL' }),
            expect.objectContaining({
                description: 'Refresh when it starts',
                label: 'Contest has not started yet',
            }),
        ]);
        expect(rootChildren[1].command).toBeUndefined();
        expect(rootChildren[1].contextValue).toBeUndefined();
    });
});