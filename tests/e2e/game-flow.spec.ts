import { expect, test } from '@playwright/test';
import { BoardPage } from './page-objects/BoardPage';
import { HostPage } from './page-objects/HostPage';
import { PlayerPage } from './page-objects/PlayerPage';
import { clearDatabase, seedFixtures, startTestServer, stopTestServer } from './helpers/server-setup';

let baseUrl = '';
let gameId = '';

type SessionClients = {
    host: HostPage;
    board: BoardPage;
    playerOne: PlayerPage;
    playerTwo: PlayerPage;
    boardContext: any;
    playerOneContext: any;
    playerTwoContext: any;
    boardRawPage: any;
};

test.describe.serial('Game flow E2E with two players', () => {
    test.beforeAll(async () => {
        baseUrl = await startTestServer();
    });

    test.afterAll(async () => {
        await stopTestServer();
    });

    test.beforeEach(async () => {
        await clearDatabase();
        const ids = await seedFixtures();
        gameId = ids.quizSmallAllTypes5x5;
    });

    async function setupSession(page: any, browser: any): Promise<SessionClients> {
        const host = new HostPage(page, baseUrl);

        const boardContext = await browser.newContext();
        const boardRawPage = await boardContext.newPage();
        const board = new BoardPage(boardRawPage, baseUrl);

        const playerOneContext = await browser.newContext();
        const playerOneRawPage = await playerOneContext.newPage();
        const playerOne = new PlayerPage(playerOneRawPage, baseUrl);

        const playerTwoContext = await browser.newContext();
        const playerTwoRawPage = await playerTwoContext.newPage();
        const playerTwo = new PlayerPage(playerTwoRawPage, baseUrl);

        await host.gotoWithGameId(gameId);
        const roomCode = await host.getRoomCode();

        await board.goto(roomCode);

        await playerOne.goto(roomCode);
        await playerOne.join('Player One');

        await playerTwo.goto(roomCode);
        await playerTwo.join('Player Two');

        await host.waitForPlayer('Player One');
        await host.waitForPlayer('Player Two');

        await playerOne.isGameVisible();
        await playerTwo.isGameVisible();

        await host.clickIntroUntilGridVisible();
        await board.waitUntilIntroEnds();

        return {
            host,
            board,
            playerOne,
            playerTwo,
            boardContext,
            playerOneContext,
            playerTwoContext,
            boardRawPage,
        };
    }

    async function cleanupSession(clients: SessionClients): Promise<void> {
        await clients.boardContext.close();
        await clients.playerOneContext.close();
        await clients.playerTwoContext.close();
    }

    test('host, board and two players complete first question with real UI clicks', async ({ page, browser }) => {
        test.setTimeout(90000);
        const clients = await setupSession(page, browser);
        const { host, board, playerOne, playerTwo, boardRawPage } = clients;

        try {
            await host.openQuestion(0, 0);
            await board.waitForQuestionOverlay();
            await board.expectQuestionContains('Standard question 1');

            const hostOverlayShot = await page.locator('#active-question-section').screenshot({ animations: 'disabled' });
            expect(hostOverlayShot.byteLength).toBeGreaterThan(5000);

            const boardOverlayShot = await boardRawPage
                .locator('#question-overlay')
                .screenshot({ animations: 'disabled' });
            expect(boardOverlayShot.byteLength).toBeGreaterThan(5000);

            await playerOne.buzz();
            await expect.poll(async () => await host.buzzWinnerName()).toContain('Player One');

            await host.markCorrect();

            await expect.poll(async () => await host.scoreForPlayer('Player One')).toBeGreaterThan(0);
            await expect.poll(async () => await host.scoreForPlayer('Player Two')).toBe(0);

            await board.playerCardContains('Player One');
            await board.playerCardContains('Player Two');

            await host.closeQuestion();
            await board.expectCardPlayed(0, 0);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('map question flow with two player submissions and board resolve', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board, playerOne, playerTwo } = clients;

        try {
            await host.openQuestion(0, 1);
            await host.expectMapControlsVisible();

            await playerOne.waitForMapInterface();
            await playerTwo.waitForMapInterface();

            await page.waitForTimeout(500);
            await playerOne.selectMapPointAndSubmit();
            await playerTwo.selectMapPointAndSubmit();

            await expect.poll(async () => await host.mapSubmittedCountText()).toBe('2/2');

            await host.resolveMap();
            await board.expectMapVisible();

            await host.closeQuestion();
            await board.expectCardPlayed(0, 1);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('estimate and freetext flows with two player submissions', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board, playerOne, playerTwo } = clients;

        try {
            await host.openQuestion(0, 2);
            await host.expectEstimateControlsVisible();

            await playerOne.waitForEstimateInterface();
            await playerTwo.waitForEstimateInterface();
            await playerOne.submitEstimate(200);
            await playerTwo.submitEstimate(210);

            await expect.poll(async () => await host.estimateSubmittedCountText()).toBe('2/2');

            await host.resolveEstimate();
            await board.expectEstimateResultsVisible();
            await host.closeQuestion();
            await board.expectCardPlayed(0, 2);

            await host.openQuestion(1, 0);
            await host.expectFreetextControlsVisible();

            await playerOne.waitForFreetextInterface();
            await playerTwo.waitForFreetextInterface();
            await playerOne.submitFreetext('Antwort von Spieler 1');
            await playerTwo.submitFreetext('Antwort von Spieler 2');

            await expect.poll(async () => await host.freetextSubmittedCountText()).toBe('2/2');

            await host.resolveFreetext();
            await host.expectFreetextGradingVisible();
            await board.expectFreetextResultsVisible();
            await host.closeQuestion();
            await board.expectCardPlayed(1, 0);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('list, pixel and elemination controls are usable and visible', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board, boardRawPage } = clients;

        try {
            await host.openQuestion(0, 3);
            await host.expectListControlsVisible();
            await host.revealNextListItem();
            await board.expectListVisible();
            await host.closeQuestion();
            await board.expectCardPlayed(0, 3);

            await host.openQuestion(0, 4);
            await host.expectPixelControlsVisible();
            await host.pausePixel();
            await host.resumePixel();
            await board.expectQuestionMediaVisible();
            await host.closeQuestion();
            await board.expectCardPlayed(0, 4);

            await host.openQuestion(1, 1);
            await host.expectEleminationControlsVisible();
            await host.revealAllElemination();
            await expect(boardRawPage.locator('#elemination-container')).toBeVisible();
            await host.closeQuestion();
            await board.expectCardPlayed(1, 1);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('standard buzz flow supports incorrect answer and buzzer unlock for second player', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board, playerOne, playerTwo } = clients;

        try {
            await host.openQuestion(1, 2);
            await board.waitForQuestionOverlay();
            await host.expectStandardQuestionControlsVisible();

            await playerOne.expectBuzzerReady();
            await playerTwo.expectBuzzerReady();

            await playerOne.buzz();
            await host.expectBuzzWinnerVisible();
            await expect.poll(async () => await host.buzzWinnerName()).toContain('Player One');
            await playerTwo.expectBuzzerWaitingOrLocked();

            await host.markIncorrect();
            await host.expectBuzzWinnerHidden();
            await expect.poll(async () => await host.scoreForPlayer('Player One')).toBeLessThanOrEqual(0);

            await host.unlockBuzzers();
            await playerTwo.expectBuzzerReady();
            await playerTwo.buzz();

            await expect.poll(async () => await host.buzzWinnerName()).toContain('Player Two');
            await host.markCorrect();
            await expect.poll(async () => await host.scoreForPlayer('Player Two')).toBeGreaterThan(0);

            await host.closeQuestion();
            await board.expectCardPlayed(1, 2);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('podium shows sorted players after scoring', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, boardRawPage, playerOne } = clients;

        try {
            await host.openQuestion(0, 0);
            await playerOne.buzz();
            await expect.poll(async () => await host.buzzWinnerName()).toContain('Player One');
            await host.markCorrect();
            await host.closeQuestion();

            await host.showPodium();

            await expect(boardRawPage.locator('#podium-overlay')).toBeVisible();
            await expect(boardRawPage.locator('#p1-name')).toHaveText('Player One');
            await expect(boardRawPage.locator('#p2-name')).toHaveText('Player Two');
            await expect(boardRawPage.locator('#p1-score')).not.toHaveText('0');
        } finally {
            await cleanupSession(clients);
        }
    });

    test('host can toggle QR overlay and theme', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board } = clients;

        try {
            await board.expectQrOverlayVisible();

            await host.toggleQrOverlay();
            await board.expectQrOverlayHidden();

            await host.toggleQrOverlay();
            await board.expectQrOverlayVisible();

            const beforeTheme = await host.currentThemeMode();
            await host.toggleTheme();
            const afterTheme = await host.currentThemeMode();
            expect(afterTheme).not.toBe(beforeTheme);
        } finally {
            await cleanupSession(clients);
        }
    });

    test('host session restore works after reload with active question', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host } = clients;

        try {
            await host.openQuestion(0, 0);
            await host.expectStandardQuestionControlsVisible();

            await page.reload();

            await expect(page.locator('#active-question-section')).toBeVisible({ timeout: 15000 });
            await host.expectStandardQuestionControlsVisible();
        } finally {
            await cleanupSession(clients);
        }
    });

    test('host can end session and board shows ended message', async ({ page, browser }) => {
        test.setTimeout(120000);
        const clients = await setupSession(page, browser);
        const { host, board } = clients;

        try {
            await host.endSessionAndExpectRedirect();
            await board.expectSessionEndedMessage();
        } finally {
            await cleanupSession(clients);
        }
    });
});
