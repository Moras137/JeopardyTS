import { test, expect } from '@playwright/test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { GameModel } from '../../src/models/Quiz';
import { mockGame } from '../fixtures/mock-data';

let mongoServer: MongoMemoryServer;
let baseUrl = '';
let gameId = '';
let connectDatabase: ((uri?: string) => Promise<void>) | null = null;
let server: any = null;

test.beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const serverModule = require('../../src/server');
    connectDatabase = serverModule.connectDatabase;
    server = serverModule.server;

    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }

    if (!connectDatabase) throw new Error('connectDatabase not available');
    await connectDatabase(mongoUri);

    if (!server.listening) {
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve());
        });
    }

    const addr = server.address();
    if (!addr || typeof addr === 'string') {
        throw new Error('Server address unavailable');
    }

    baseUrl = `http://localhost:${addr.port}`;

    const saved = await new GameModel(mockGame).save();
    gameId = saved._id!.toString();
});

test.afterAll(async () => {
    await GameModel.deleteMany({});

    if (server.listening) {
        await new Promise<void>((resolve, reject) => {
            server.close((err: Error | undefined) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }

    if (mongoServer) {
        await mongoServer.stop();
    }
});

test.describe('Real App Smoke E2E', () => {
    test('should load game list from real API', async ({ request }) => {
        const res = await request.get(`${baseUrl}/api/games`);
        expect(res.status()).toBe(200);

        const games = await res.json();
        expect(Array.isArray(games)).toBe(true);
        expect(games.some((g: any) => g._id === gameId)).toBe(true);
    });

    test('should create a room and join from player UI against real server', async ({ page, browser }) => {
        const hostPage = page;
        const playerContext = await browser.newContext();
        const playerPage = await playerContext.newPage();

        await hostPage.goto(`${baseUrl}/host.html?gameId=${gameId}`);
        await expect(hostPage.locator('#room-code-display')).toHaveText(/\d{4}/, { timeout: 10000 });
        const roomCode = (await hostPage.locator('#room-code-display').innerText()).trim();

        await playerPage.goto(`${baseUrl}/player.html?room=${roomCode}`);
        await playerPage.fill('#player-name', 'SmokePlayer');
        await playerPage.click('#join-btn');

        await expect(hostPage.locator('#player-list li', { hasText: 'SmokePlayer' })).toBeVisible({ timeout: 10000 });

        await playerContext.close();
    });

    test('should save from create page', async ({ page }) => {
        const dialogs: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await page.goto(`${baseUrl}/create.html`);
        await page.click('#btn-dashboard-new');

        await page.fill('#numCategories', '1');
        await page.dispatchEvent('#numCategories', 'change');
        await page.fill('#numQuestions', '1');
        await page.dispatchEvent('#numQuestions', 'change');

        await page.fill('#gameTitle', 'Save Smoke Quiz');
        await page.locator('.question-block .q-text').first().fill('Smoke Test Frage');
        await page.locator('.question-block .q-answer').first().fill('Smoke Test Antwort');

        await page.click('#btn-save');

        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Gespeichert!')), { timeout: 15000 })
            .toBe(true);
    });
});
