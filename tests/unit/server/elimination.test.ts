import { getEleminationRemainingPlayerIds } from '../../../src/server';
import { ISession } from '../../../src/types';

function buildSession(): ISession {
    return {
        gameId: 'g1',
        game: { title: 'Quiz', categories: [] } as any,
        hostSocketId: 'host',
        players: {
            p1: { id: 'p1', name: 'Alice', score: 0, socketId: 's1', color: '#111', active: true },
            p2: { id: 'p2', name: 'Bob', score: 0, socketId: 's2', color: '#222', active: true },
            p3: { id: 'p3', name: 'Cara', score: 0, socketId: 's3', color: '#333', active: false },
        },
        playerOrder: ['p1', 'p2', 'p3'],
        currentTurnPlayerId: 'p1',
        lastEleminationRevealerId: null,
        buzzersActive: false,
        currentBuzzWinnerId: null,
        activeQuestion: null,
        activeQuestionPoints: 100,
        activeCatIndex: -1,
        activeQIndex: -1,
        mapResolved: false,
        mapGuesses: {},
        estimateGuesses: {},
        usedQuestions: [],
        introIndex: -2,
        listRevealedCount: -1,
        eleminationRevealedIndices: [],
        eleminationEliminatedPlayerIds: [],
        eleminationRoundResolved: false,
        freetextAnswers: {},
        lockedPlayers: [],
    };
}

describe('Elimination Behavior Helpers', () => {
    it('should return only active and not-yet-eliminated players', () => {
        const session = buildSession();
        session.eleminationEliminatedPlayerIds = ['p2'];

        const remaining = getEleminationRemainingPlayerIds(session);
        expect(remaining).toEqual(['p1']);
    });

    it('should initialize missing eliminated array defensively', () => {
        const session = buildSession();
        session.eleminationEliminatedPlayerIds = undefined as any;

        const remaining = getEleminationRemainingPlayerIds(session);
        expect(Array.isArray(session.eleminationEliminatedPlayerIds)).toBe(true);
        expect(remaining).toEqual(['p1', 'p2']);
    });

    it('should return empty when all active players are eliminated', () => {
        const session = buildSession();
        session.eleminationEliminatedPlayerIds = ['p1', 'p2'];

        const remaining = getEleminationRemainingPlayerIds(session);
        expect(remaining).toEqual([]);
    });
});
