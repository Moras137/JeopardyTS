import fs from 'fs/promises';
import path from 'path';
import {
    calculateDistance,
    deleteMediaFile,
    generateRoomCode,
    getLocalIpAddress,
    isPointInPolygon,
    PUBLIC_DIR,
} from '../../../src/server';
import { sessions } from '../../../src/server';

describe('Server Helper Functions (real implementation)', () => {
    describe('calculateDistance', () => {
        it('should calculate distance for real coordinates (Haversine)', () => {
            const distance = calculateDistance(52.52, 13.405, 48.8566, 2.3522, false);
            expect(distance).toBeGreaterThan(800000);
            expect(distance).toBeLessThan(1000000);
        });

        it('should calculate distance for custom map (Euclidean)', () => {
            const distance = calculateDistance(0, 0, 3, 4, true);
            expect(distance).toBe(5);
        });
    });

    describe('isPointInPolygon', () => {
        const square = [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 10 },
            { lat: 10, lng: 10 },
            { lat: 10, lng: 0 },
        ];

        it('should return true for point inside polygon', () => {
            expect(isPointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
        });

        it('should return false for point outside polygon', () => {
            expect(isPointInPolygon({ lat: 20, lng: 20 }, square)).toBe(false);
        });
    });

    describe('generateRoomCode', () => {
        afterEach(() => {
            jest.restoreAllMocks();
            Object.keys(sessions).forEach((code) => delete sessions[code]);
        });

        it('should generate a 4-digit room code', () => {
            const code = generateRoomCode();
            expect(code).toMatch(/^\d{4}$/);
        });

        it('should skip already used room codes', () => {
            sessions['1234'] = {
                gameId: 'g1',
                game: { title: 't', categories: [] } as any,
                hostSocketId: 'h1',
                players: {},
                playerOrder: [],
                currentTurnPlayerId: null,
                lastEleminationRevealerId: null,
                buzzersActive: false,
                currentBuzzWinnerId: null,
                activeQuestion: null,
                activeQuestionPoints: 0,
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

            const randomSpy = jest
                .spyOn(Math, 'random')
                .mockReturnValueOnce((1234 - 1000) / 9000)
                .mockReturnValueOnce((5678 - 1000) / 9000);

            const code = generateRoomCode();
            expect(code).toBe('5678');
            expect(randomSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('getLocalIpAddress', () => {
        it('should return a non-empty string', () => {
            const ip = getLocalIpAddress();
            expect(typeof ip).toBe('string');
            expect(ip.length).toBeGreaterThan(0);
        });
    });

    describe('deleteMediaFile', () => {
        it('should reject unsafe traversal-like paths safely', async () => {
            await expect(deleteMediaFile('../../secret.txt')).resolves.toBeUndefined();
        });

        it('should delete a local file inside public directory', async () => {
            const fileName = `test-delete-${Date.now()}.tmp`;
            const uploadsDir = path.join(PUBLIC_DIR, 'uploads');
            const absolutePath = path.join(uploadsDir, fileName);

            await fs.mkdir(uploadsDir, { recursive: true });
            await fs.writeFile(absolutePath, 'temp');

            await deleteMediaFile(`/uploads/${fileName}`);
            await expect(fs.stat(absolutePath)).rejects.toBeDefined();
        });
    });
});
