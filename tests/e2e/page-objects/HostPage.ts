import { expect, type Locator, type Page } from '@playwright/test';

export class HostPage {
    constructor(private readonly page: Page, private readonly baseUrl: string) {}

    async gotoWithGameId(gameId: string): Promise<void> {
        await this.page.goto(`${this.baseUrl}/host.html?gameId=${gameId}`);
        await expect(this.page.locator('#room-code-display')).toHaveText(/\d{4}/, { timeout: 15000 });
    }

    async getRoomCode(): Promise<string> {
        return (await this.page.locator('#room-code-display').innerText()).trim();
    }

    async waitForPlayer(name: string): Promise<void> {
        await expect(this.page.locator('#player-list li', { hasText: name })).toBeVisible({ timeout: 15000 });
    }

    async clickIntroUntilGridVisible(maxClicks = 25): Promise<void> {
        const btn = this.page.locator('#btn-intro-next');
        for (let i = 0; i < maxClicks; i += 1) {
            const gridVisible = await this.page.locator('#host-grid').isVisible().catch(() => false);
            if (gridVisible) {
                break;
            }

            const visible = await btn.isVisible().catch(() => false);
            if (!visible) {
                await this.page.waitForTimeout(150);
                continue;
            }

            try {
                await btn.click({ timeout: 1200 });
            } catch {
                await this.page.waitForTimeout(150);
            }

            const gridVisibleAfter = await this.page.locator('#host-grid').isVisible().catch(() => false);
            if (gridVisibleAfter) {
                break;
            }
        }
        await expect(this.page.locator('#host-grid')).toBeVisible();
    }

    questionButton(catIndex: number, qIndex: number): Locator {
        return this.page.locator(`#q-btn-${catIndex}-${qIndex}`);
    }

    async openQuestion(catIndex: number, qIndex: number): Promise<void> {
        await this.questionButton(catIndex, qIndex).click();
        await expect(this.page.locator('#active-question-section')).toBeVisible();
    }

    async markCorrect(): Promise<void> {
        await this.page.locator('#correct-btn').click();
    }

    async markIncorrect(): Promise<void> {
        await this.page.locator('#incorrect-btn').click();
    }

    async unlockBuzzers(): Promise<void> {
        await this.page.locator('#unlock-buzzers-btn').click();
    }

    async resolveMap(): Promise<void> {
        await this.page.locator('#resolve-map-btn').click();
    }

    async resolveEstimate(): Promise<void> {
        await this.page.locator('#resolve-estimate-btn').click();
    }

    async resolveFreetext(): Promise<void> {
        await this.page.locator('#resolve-freetext-btn').click();
    }

    async revealNextListItem(): Promise<void> {
        await this.page.locator('#btn-reveal-list').click();
    }

    async revealAllElemination(): Promise<void> {
        await this.page.locator('#btn-reveal-all-elemination').click();
    }

    async pausePixel(): Promise<void> {
        await this.page.locator('#btn-pixel-pause').click();
    }

    async resumePixel(): Promise<void> {
        await this.page.locator('#btn-pixel-resume').click();
    }

    async mapSubmittedCountText(): Promise<string> {
        return (await this.page.locator('#map-submitted-count').innerText()).trim();
    }

    async estimateSubmittedCountText(): Promise<string> {
        return (await this.page.locator('#estimate-submitted-count').innerText()).trim();
    }

    async freetextSubmittedCountText(): Promise<string> {
        return (await this.page.locator('#freetext-submitted-count').innerText()).trim();
    }

    async expectMapControlsVisible(): Promise<void> {
        await expect(this.page.locator('#map-mode-controls')).toBeVisible();
    }

    async expectEstimateControlsVisible(): Promise<void> {
        await expect(this.page.locator('#estimate-mode-controls')).toBeVisible();
    }

    async expectFreetextControlsVisible(): Promise<void> {
        await expect(this.page.locator('#freetext-mode-controls')).toBeVisible();
    }

    async expectListControlsVisible(): Promise<void> {
        await expect(this.page.locator('#list-mode-controls')).toBeVisible();
    }

    async expectPixelControlsVisible(): Promise<void> {
        await expect(this.page.locator('#pixel-mode-controls')).toBeVisible();
    }

    async expectEleminationControlsVisible(): Promise<void> {
        await expect(this.page.locator('#elemination-mode-controls')).toBeVisible();
    }

    async expectFreetextGradingVisible(): Promise<void> {
        await expect(this.page.locator('#freetext-grading-view')).toBeVisible();
    }

    async expectBuzzWinnerVisible(): Promise<void> {
        await expect(this.page.locator('#buzz-winner-section')).toBeVisible();
    }

    async expectBuzzWinnerHidden(): Promise<void> {
        await expect(this.page.locator('#buzz-winner-section')).toBeHidden();
    }

    async expectStandardQuestionControlsVisible(): Promise<void> {
        await expect(this.page.locator('#unlock-buzzers-btn')).toBeVisible();
        await expect(this.page.locator('#resolve-question-btn')).toBeVisible();
        await expect(this.page.locator('#map-mode-controls')).toBeHidden();
        await expect(this.page.locator('#estimate-mode-controls')).toBeHidden();
        await expect(this.page.locator('#freetext-mode-controls')).toBeHidden();
        await expect(this.page.locator('#list-mode-controls')).toBeHidden();
        await expect(this.page.locator('#pixel-mode-controls')).toBeHidden();
        await expect(this.page.locator('#elemination-mode-controls')).toBeHidden();
    }

    async resolveCurrentQuestion(): Promise<void> {
        this.page.once('dialog', (dialog) => dialog.accept());
        await this.page.locator('#resolve-question-btn').click();
    }

    async showPodium(): Promise<void> {
        this.page.once('dialog', (dialog) => dialog.accept());
        await this.page.locator('#btn-podium').click();
    }

    async toggleQrOverlay(): Promise<void> {
        await this.page.locator('#toggle-qr-btn').click();
    }

    async toggleTheme(): Promise<void> {
        await this.page.locator('#theme-toggle-btn').click();
    }

    async currentThemeMode(): Promise<'dark' | 'light'> {
        const mode = await this.page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        return mode === 'dark' ? 'dark' : 'light';
    }

    async endSessionAndExpectRedirect(): Promise<void> {
        this.page.once('dialog', (dialog) => dialog.accept());
        await this.page.locator('#exit-quiz-btn').click();
        await expect(this.page).toHaveURL(/\/create\.html$/);
    }

    async closeQuestion(): Promise<void> {
        await this.page.locator('#btn-close-modal-top').click();
        await expect(this.page.locator('#active-question-section')).toBeHidden();
    }

    async scoreForPlayer(name: string): Promise<number> {
        const row = this.page.locator('#player-list li').filter({ hasText: name }).first();
        await expect(row).toBeVisible();
        const scoreText = await row.locator('.score').innerText();
        const value = Number(scoreText.trim());
        return Number.isFinite(value) ? value : 0;
    }

    async buzzWinnerName(): Promise<string> {
        return (await this.page.locator('#buzz-winner-name').innerText()).trim();
    }
}
