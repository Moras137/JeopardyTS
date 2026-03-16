import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { expect, test } from '@playwright/test';
import { CreatePage } from './page-objects/CreatePage';
import { clearDatabase, seedFixtures, startTestServer, stopTestServer } from './helpers/server-setup';

let baseUrl = '';

test.describe.serial('Create UI E2E', () => {
    test.beforeAll(async () => {
        baseUrl = await startTestServer();
    });

    test.afterAll(async () => {
        await stopTestServer();
    });

    test.beforeEach(async () => {
        await clearDatabase();
        await seedFixtures();
    });

    test('shows seeded dashboard and stable visual layout', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        await expect(page.locator('#dashboard-grid .quiz-tile')).toHaveCount(6);
        const screenshot = await page.locator('#dashboard-grid').screenshot({ animations: 'disabled' });
        expect(screenshot.byteLength).toBeGreaterThan(10000);
    });

    test('opens anleitung page from dashboard button', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        await createPage.clickAnleitung();
        await expect(page).toHaveURL(/\/anleitung\.html$/);
        await expect(page.locator('body')).toBeVisible();
    });

    test('filters quiz tiles via dashboard and sidebar search', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        await createPage.searchDashboard('10x10');
        await expect(page.locator('#dashboard-grid .quiz-tile')).toHaveCount(1);
        await expect(createPage.dashboardTileByTitle('E2E Grid 10x10')).toHaveCount(1);

        await createPage.searchDashboard('');
        await expect(page.locator('#dashboard-grid .quiz-tile')).toHaveCount(6);

        await createPage.openEditorFromTile('E2E All Types 5x5');
        await createPage.openSidebar();
        await createPage.searchSidebar('1x15');
        await expect(page.locator('#game-list .load-item')).toHaveCount(1);
        await expect(page.locator('#game-list .load-item', { hasText: 'E2E Grid 1x15' })).toBeVisible();
    });

    test('starts host session from dashboard play button', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        await createPage.startPlayFromTile('E2E All Types 5x5');
        await expect(page).toHaveURL(/\/host\.html\?gameId=/);
        await expect(page.locator('#room-code-display')).toHaveText(/\d{4}/);
    });

    test('supports create, edit, export, import and delete via UI clicks', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        const dialogs: string[] = [];

        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await createPage.goto();
        await createPage.createSimpleQuiz('E2E UI Created Quiz', 'Created question', 'Created answer');
        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Gespeichert!')))
            .toBe(true);

        await page.click('#btn-back-dashboard');
        await expect(createPage.dashboardTileByTitle('E2E UI Created Quiz')).toHaveCount(1);

        await createPage.openEditorFromTile('E2E UI Created Quiz');
        await createPage.saveEditedTitle('E2E UI Edited Quiz');
        await expect
            .poll(() => dialogs.filter((msg) => msg.includes('Gespeichert!')).length)
            .toBeGreaterThan(1);

        await page.click('#btn-back-dashboard');
        await expect(createPage.dashboardTileByTitle('E2E UI Edited Quiz')).toHaveCount(1);

        const downloadPromise = page.waitForEvent('download');
        await createPage.exportFromTile('E2E UI Edited Quiz');
        const download = await downloadPromise;
        const exportedFilePath = await download.path();
        expect(exportedFilePath).toBeTruthy();

        const beforeDeleteCount = await page.locator('#dashboard-grid .quiz-tile').count();
        await createPage.deleteFromTile('E2E UI Edited Quiz');
        await expect(page.locator('#dashboard-grid .quiz-tile')).toHaveCount(beforeDeleteCount - 1);

        await createPage.importBundle(exportedFilePath as string);

        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Import erfolgreich')))
            .toBe(true);

        await expect(createPage.dashboardTileByTitle('E2E UI Edited Quiz')).toHaveCount(1);
    });

    test('renders board preview correctly for 5x5, 10x10, 1x15 and 15x1', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        const checks = [
            { title: 'E2E All Types 5x5', categories: 5, questions: 5 },
            { title: 'E2E Grid 10x10', categories: 10, questions: 10 },
            { title: 'E2E Grid 1x15', categories: 1, questions: 15 },
            { title: 'E2E Grid 15x1', categories: 15, questions: 1 },
        ];

        for (const check of checks) {
            await createPage.openEditorFromTile(check.title);
            await createPage.switchToBoardPreview();

            await expect(createPage.boardHeaders()).toHaveCount(check.categories);
            await expect(createPage.boardCards()).toHaveCount(check.categories * check.questions);

            const boardScreenshot = await page.locator('#preview-grid').screenshot({ animations: 'disabled' });
            expect(boardScreenshot.byteLength).toBeGreaterThan(1200);

            await page.click('#btn-back-dashboard');
            await expect(page.locator('#quiz-dashboard')).toBeVisible();
        }
    });

    test('shows correct tooltips and media icons in board preview', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();
        await createPage.openEditorFromTile('E2E Media Icons 3x3');
        await createPage.switchToBoardPreview();

        const cards = createPage.boardCards();
        await expect(cards).toHaveCount(9);

        await cards.nth(0).hover();
        await expect(page.locator('#preview-tooltip')).toBeVisible();
        await expect(page.locator('#preview-tooltip')).toContainText('Image media question');
        await expect(page.locator('#preview-tooltip')).toContainText('Fox');

        await expect(cards.nth(0).locator('.media-indicator.left')).toHaveText('🖼️');
        await expect(cards.nth(3).locator('.media-indicator.left')).toHaveText('🎵');
        await expect(cards.nth(6).locator('.media-indicator.left')).toHaveText('🎥');

        await expect(cards.nth(1).locator('.media-indicator.right')).toHaveText('🖼️');
        await expect(cards.nth(4).locator('.media-indicator.right')).toHaveText('🎵');
        await expect(cards.nth(7).locator('.media-indicator.right')).toHaveText('🎥');

        await expect(cards.nth(5).locator('.media-indicator')).toHaveCount(0);

        await cards.nth(5).hover();
        await expect(page.locator('#preview-tooltip')).toContainText('No media');
    });

    test('uploads board background from file input and displays preview', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();
        await createPage.openEditorFromTile('E2E Minimal 1x1');

        await createPage.uploadBoardBackgroundVirtualFile();

        await expect(page.locator('#background-status')).toContainText('Fertig');
        await expect(page.locator('#preview-background img, #preview-background video, #preview-background audio')).toHaveCount(1);

        await page.click('#btn-remove-bg');
        await expect(page.locator('#preview-background')).toBeEmpty();
    });

    test('supports drag and drop upload for background and music zones', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();
        await createPage.openEditorFromTile('E2E Minimal 1x1');

        await createPage.dropVirtualImageOnZone('#drop-zone-bg');
        await expect(page.locator('#background-status')).toContainText('Fertig');
        await expect
            .poll(async () => await page.locator('#background-path').inputValue())
            .toMatch(/^\/.+/);
        await expect(page.locator('#preview-background img, #preview-background video, #preview-background audio')).toHaveCount(1);

        await createPage.dropVirtualAudioOnZone('#drop-zone-music');
        await expect(page.locator('#music-status')).toContainText('Fertig');
        await expect
            .poll(async () => await page.locator('#background-music-path').inputValue())
            .toMatch(/^\/.+/);
        await expect(page.locator('#music-preview')).toBeVisible();
    });

    test('imports sample bundle from import-samples directory', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        const sampleDir = path.resolve(process.cwd(), 'import-samples', 'alle-typen-bundle');
        const manifestPath = path.resolve(sampleDir, 'quiz-import-manifest.json');
        const quizPath = path.resolve(sampleDir, 'quiz.json');
        const tempZipPath = path.resolve(os.tmpdir(), `jeopardy-import-${Date.now()}.zip`);

        const [manifestContent, quizContent] = await Promise.all([
            fs.readFile(manifestPath),
            fs.readFile(quizPath),
        ]);

        const zip = new AdmZip();
        zip.addFile('quiz-import-manifest.json', manifestContent);
        zip.addFile('quiz.json', quizContent);
        await fs.writeFile(tempZipPath, zip.toBuffer());

        const beforeCount = await page.locator('#dashboard-grid .quiz-tile').count();
        const dialogs: string[] = [];

        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await createPage.importBundle(tempZipPath);

        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Import erfolgreich')))
            .toBe(true);

        await expect(page.locator('#dashboard-grid .quiz-tile')).toHaveCount(beforeCount + 1);

        await fs.unlink(tempZipPath).catch(() => undefined);
    });

    test('shows import error dialog for invalid bundle file', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        const dialogs: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        const invalidZipPath = path.resolve(os.tmpdir(), `jeopardy-invalid-${Date.now()}.zip`);
        await fs.writeFile(invalidZipPath, Buffer.from('invalid zip payload', 'utf8'));

        await createPage.importBundle(invalidZipPath);

        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Import fehlgeschlagen')))
            .toBe(true);

        await fs.unlink(invalidZipPath).catch(() => undefined);
    });

    test('shows export error dialog when backend export fails', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();

        const dialogs: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await page.route('**/api/games/*/export', async (route) => {
            await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced export failure' });
        });

        await createPage.exportFromTile('E2E All Types 5x5');

        await expect
            .poll(() => dialogs.some((msg) => msg.includes('Export fehlgeschlagen')))
            .toBe(true);
    });

    test('shows upload error status when media upload fails', async ({ page }) => {
        const createPage = new CreatePage(page, baseUrl);
        await createPage.goto();
        await createPage.openEditorFromTile('E2E Minimal 1x1');

        await page.route('**/api/upload', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: 'forced upload failure' }),
            });
        });

        await createPage.uploadBoardBackgroundVirtualFile();
        await expect(page.locator('#background-status')).toContainText('Fehler');
    });
});
