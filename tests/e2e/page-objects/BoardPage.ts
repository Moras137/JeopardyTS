import { expect, type Page } from '@playwright/test';

export class BoardPage {
    constructor(private readonly page: Page, private readonly baseUrl: string) {}

    async goto(roomCode: string): Promise<void> {
        await this.page.goto(`${this.baseUrl}/board.html?room=${roomCode}`);
        await expect(this.page.locator('#game-grid')).toBeVisible({ timeout: 15000 });
    }

    async waitUntilIntroEnds(): Promise<void> {
        await expect(this.page.locator('#intro-overlay')).toBeHidden({ timeout: 20000 });
        await expect(this.page.locator('#game-grid')).toBeVisible();
    }

    async waitForQuestionOverlay(): Promise<void> {
        await expect(this.page.locator('#question-overlay')).toBeVisible({ timeout: 15000 });
    }

    async expectQuestionContains(text: string): Promise<void> {
        await expect(this.page.locator('#question-text')).toContainText(text);
    }

    async playerCardContains(name: string): Promise<void> {
        await expect(this.page.locator('#player-bar .player-card', { hasText: name })).toBeVisible({ timeout: 15000 });
    }

    async expectCardPlayed(catIndex: number, qIndex: number): Promise<void> {
        await expect(this.page.locator(`#card-${catIndex}-${qIndex}`)).toHaveClass(/played/);
    }

    async expectMapVisible(): Promise<void> {
        await expect(this.page.locator('#q-map')).toBeVisible({ timeout: 15000 });
    }

    async expectEstimateResultsVisible(): Promise<void> {
        await expect(this.page.locator('#estimate-results')).toBeVisible({ timeout: 15000 });
    }

    async expectFreetextResultsVisible(): Promise<void> {
        await expect(this.page.locator('#freetext-container')).toBeVisible({ timeout: 15000 });
    }

    async expectListVisible(): Promise<void> {
        await expect(this.page.locator('#list-container')).toBeVisible({ timeout: 15000 });
    }

    async expectQuestionMediaVisible(): Promise<void> {
        await expect(this.page.locator('#media-container')).toBeVisible({ timeout: 15000 });
    }

    async expectQrOverlayVisible(): Promise<void> {
        await expect(this.page.locator('#qr-overlay')).toBeVisible({ timeout: 15000 });
    }

    async expectQrOverlayHidden(): Promise<void> {
        await expect(this.page.locator('#qr-overlay')).toBeHidden({ timeout: 15000 });
    }

    async expectSessionEndedMessage(): Promise<void> {
        await expect(this.page.locator('#question-overlay')).toBeVisible({ timeout: 15000 });
        await expect(this.page.locator('#question-text')).toContainText('Sitzung beendet', { timeout: 15000 });
    }
}
