import request from 'supertest';
import { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { GameModel } from '../../src/models/Quiz';
import { app as realApp } from '../../src/server';
import { mockCategory } from '../fixtures/mock-data';

/**
 * API Endpoints Integration Tests
 * Tests all REST API endpoints with in-memory MongoDB
 */

let app: Express;
let mongoServer: MongoMemoryServer;

// ============================================================
// TEST SETUP & TEARDOWN
// ============================================================

beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    // Connect mongoose to in-memory database
    await mongoose.connect(mongoUri);

    app = realApp as Express;
}, 30000); // 30 second timeout for mongodb-memory-server startup

afterAll(async () => {
    // Cleanup
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
});

afterEach(async () => {
    // Clear database between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});

// ============================================================
// TEST SUITES
// ============================================================

describe('API Endpoints - Integration Tests', () => {
    describe('GET /api/games', () => {
        it('should return empty array when no games exist', async () => {
            const res = await request(app).get('/api/games');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBe(0);
        });

        it('should return list of games with selected fields', async () => {
            const gameData = {
                title: 'Test Game 1',
                categories: [mockCategory],
                boardBackgroundPath: '/images/bg.jpg',
            };
            const savedGame = await new GameModel(gameData).save();

            const res = await request(app).get('/api/games');
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0]._id.toString()).toBe(savedGame._id.toString());
            expect(res.body[0].title).toBe('Test Game 1');
            expect(res.body[0].boardBackgroundPath).toBe('/images/bg.jpg');
        });

        it('should return multiple games in list', async () => {
            const game1 = await new GameModel({
                title: 'Game 1',
                categories: [mockCategory],
            }).save();
            const game2 = await new GameModel({
                title: 'Game 2',
                categories: [mockCategory],
            }).save();

            const res = await request(app).get('/api/games');
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
            const ids = res.body.map((g: any) => g._id.toString());
            expect(ids).toContain(game1._id.toString());
            expect(ids).toContain(game2._id.toString());
        });
    });

    describe('GET /api/games/:id', () => {
        it('should return 404 for non-existent game', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app).get(`/api/games/${fakeId}`);
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Nicht gefunden');
        });

        it('should return full game data for valid ID', async () => {
            const gameData = {
                title: 'Full Test Game',
                categories: [mockCategory],
                boardBackgroundPath: '/bg.png',
                soundCorrectPath: '/sounds/correct.mp3',
            };
            const savedGame = await new GameModel(gameData).save();

            const res = await request(app).get(`/api/games/${savedGame._id}`);
            expect(res.status).toBe(200);
            expect(res.body._id.toString()).toBe(savedGame._id.toString());
            expect(res.body.title).toBe('Full Test Game');
            expect(res.body.categories.length).toBe(1);
            expect(res.body.boardBackgroundPath).toBe('/bg.png');
        });

        it('should handle invalid ID format gracefully', async () => {
            const res = await request(app).get('/api/games/invalid-id');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Ungültige ID');
        });
    });

    describe('POST /api/create-game', () => {
        it('should create new game with minimal data', async () => {
            const gameData = {
                title: 'New Game',
                categories: [mockCategory],
            };

            const res = await request(app)
                .post('/api/create-game')
                .send(gameData);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.gameId).toBeDefined();

            // Verify game was persisted
            const created = await GameModel.findById(res.body.gameId);
            expect(created?.title).toBe('New Game');
        });

        it('should create game with all fields', async () => {
            const gameData = {
                title: 'Full Game',
                categories: [
                    {
                        name: 'Science',
                        questions: [
                            {
                                type: 'standard',
                                questionText: 'What is 2+2?',
                                answerText: '4',
                                points: 100,
                                negativePoints: 0,
                            },
                        ],
                    },
                ],
                boardBackgroundPath: '/images/space.jpg',
                boardMusicPath: '/music/bg.mp3',
                soundCorrectPath: '/sounds/correct.mp3',
                soundIncorrectPath: '/sounds/wrong.mp3',
                soundBuzzPath: '/sounds/buzz.mp3',
            };

            const res = await request(app)
                .post('/api/create-game')
                .send(gameData);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const created = await GameModel.findById(res.body.gameId);
            expect(created?.boardBackgroundPath).toBe('/images/space.jpg');
            expect(created?.soundCorrectPath).toBe('/sounds/correct.mp3');
        });

        it('should update existing game by ID', async () => {
            const gameData = {
                title: 'Original Title',
                categories: [mockCategory],
            };
            const savedGame = await new GameModel(gameData).save();

            const updateData = {
                _id: savedGame._id.toString(),
                title: 'Updated Title',
                categories: [mockCategory],
            };

            const res = await request(app)
                .post('/api/create-game')
                .send(updateData);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const updated = await GameModel.findById(savedGame._id);
            expect(updated?.title).toBe('Updated Title');
        });

        it('should handle invalid game data', async () => {
            const invalidData = {
                // Missing required fields
                categories: [],
            };

            const res = await request(app)
                .post('/api/create-game')
                .send(invalidData);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should include detailed validation reason outside production', async () => {
            const res = await request(app)
                .post('/api/create-game')
                .send({ title: '', categories: [] });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error).toContain('Ungültige Spieldaten:');
        });

        it('should return generic validation message in production', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            try {
                const res = await request(app)
                    .post('/api/create-game')
                    .send({ title: '', categories: [] });

                expect(res.status).toBe(400);
                expect(res.body.success).toBe(false);
                expect(res.body.error).toBe('Ungültige Spieldaten');
            } finally {
                process.env.NODE_ENV = previousEnv;
            }
        });

        it('should handle missing request body', async () => {
            const res = await request(app)
                .post('/api/create-game')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject invalid payload types', async () => {
            const res = await request(app)
                .post('/api/create-game')
                .send({ title: 1234, categories: {} });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject category with invalid question shape', async () => {
            const res = await request(app)
                .post('/api/create-game')
                .send({
                    title: 'Broken',
                    categories: [
                        {
                            name: 'Cat',
                            questions: [
                                {
                                    questionText: 'Fehlt type',
                                    answerText: 'A',
                                    points: 100,
                                },
                            ],
                        },
                    ],
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject update with invalid _id format', async () => {
            const res = await request(app)
                .post('/api/create-game')
                .send({
                    _id: 'invalid-id',
                    title: 'Updated',
                    categories: [mockCategory],
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should return 404 when updating non-existent game id', async () => {
            const nonExistentId = new mongoose.Types.ObjectId().toString();
            const res = await request(app)
                .post('/api/create-game')
                .send({
                    _id: nonExistentId,
                    title: 'Updated',
                    categories: [mockCategory],
                });

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('DELETE /api/games/:id', () => {
        it('should successfully delete existing game', async () => {
            const gameData = {
                title: 'To Delete',
                categories: [mockCategory],
            };
            const savedGame = await new GameModel(gameData).save();

            const res = await request(app).delete(`/api/games/${savedGame._id}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify deletion
            const deleted = await GameModel.findById(savedGame._id);
            expect(deleted).toBeNull();
        });

        it('should handle deletion of non-existent game', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app).delete(`/api/games/${fakeId}`);

            // Should still return success (idempotent)
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should not affect other games when deleting one', async () => {
            const game1 = await new GameModel({
                title: 'Game 1',
                categories: [mockCategory],
            }).save();
            const game2 = await new GameModel({
                title: 'Game 2',
                categories: [mockCategory],
            }).save();

            await request(app).delete(`/api/games/${game1._id}`);

            const remaining = await GameModel.findById(game2._id);
            expect(remaining).toBeDefined();
            expect(remaining?.title).toBe('Game 2');
        });

        it('should handle invalid ID format', async () => {
            const res = await request(app).delete('/api/games/invalid-id');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Ungültige ID');
        });
    });

    describe('POST /api/delete-files', () => {
        it('should accept deletion request with file list', async () => {
            const files = ['/uploads/file1.jpg', '/uploads/file2.png'];
            const res = await request(app)
                .post('/api/delete-files')
                .send({ files });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should handle empty file list', async () => {
            const res = await request(app)
                .post('/api/delete-files')
                .send({ files: [] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should handle missing files array', async () => {
            const res = await request(app)
                .post('/api/delete-files')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should handle multiple iterations of file deletion', async () => {
            const batch1 = ['/uploads/batch1-file1.jpg'];
            const batch2 = ['/uploads/batch2-file1.png', '/uploads/batch2-file2.jpg'];

            const res1 = await request(app)
                .post('/api/delete-files')
                .send({ files: batch1 });
            expect(res1.status).toBe(200);

            const res2 = await request(app)
                .post('/api/delete-files')
                .send({ files: batch2 });
            expect(res2.status).toBe(200);
        });

        it('should handle traversal-like file paths safely', async () => {
            const files = ['../../secret.txt', '/uploads/../secret.txt', '..\\..\\windows\\system.ini'];
            const res = await request(app)
                .post('/api/delete-files')
                .send({ files });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should handle absolute-like file paths safely', async () => {
            const files = ['C:/Windows/System32/drivers/etc/hosts', '/etc/passwd'];
            const res = await request(app)
                .post('/api/delete-files')
                .send({ files });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /api/upload', () => {
        it('should upload file successfully', async () => {
            const res = await request(app)
                .post('/api/upload')
                .attach('mediaFile', Buffer.from('hello world'), 'test-upload.txt');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(typeof res.body.filePath).toBe('string');
            expect(res.body.filePath).toContain('/uploads/');

            await request(app)
                .post('/api/delete-files')
                .send({ files: [res.body.filePath] });
        });

        it('should return 400 when no file is provided', async () => {
            const res = await request(app).post('/api/upload');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('API Error Handling', () => {
        it('should handle concurrent game creation', async () => {
            const gameData = {
                title: 'Concurrent Game',
                categories: [mockCategory],
            };

            const promises = [
                request(app).post('/api/create-game').send(gameData),
                request(app).post('/api/create-game').send(gameData),
                request(app).post('/api/create-game').send(gameData),
            ];

            const results = await Promise.all(promises);
            results.forEach(res => {
                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.gameId).toBeDefined();
            });

            // All should have created separate games
            const gameIds = new Set(results.map(r => r.body.gameId));
            expect(gameIds.size).toBe(3);
        });

        it('should maintain data integrity across operations', async () => {
            // Create
            const createRes = await request(app)
                .post('/api/create-game')
                .send({ title: 'Integrity Test', categories: [mockCategory] });
            const gameId = createRes.body.gameId;

            // Read
            const readRes = await request(app).get(`/api/games/${gameId}`);
            expect(readRes.body.title).toBe('Integrity Test');

            // Update
            const updateRes = await request(app)
                .post('/api/create-game')
                .send({
                    _id: gameId,
                    title: 'Updated Integrity Test',
                    categories: [mockCategory],
                });
            expect(updateRes.body.success).toBe(true);

            // Verify update
            const finalRes = await request(app).get(`/api/games/${gameId}`);
            expect(finalRes.body.title).toBe('Updated Integrity Test');

            // Delete
            const deleteRes = await request(app).delete(`/api/games/${gameId}`);
            expect(deleteRes.body.success).toBe(true);

            // Verify deletion
            const deletedRes = await request(app).get(`/api/games/${gameId}`);
            expect(deletedRes.status).toBe(404);
        });
    });
});
