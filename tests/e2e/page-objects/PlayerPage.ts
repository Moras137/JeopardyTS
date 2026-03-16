import { expect, type Page } from '@playwright/test';

export class PlayerPage {
    constructor(private readonly page: Page, private readonly baseUrl: string) {}

    async goto(roomCode: string): Promise<void> {
        await this.page.goto(`${this.baseUrl}/player.html?room=${roomCode}`);
        await expect(this.page.locator('#join-section')).toBeVisible();
    }

    async join(name: string): Promise<void> {
        await this.page.fill('#player-name', name);
        await this.page.click('#join-btn');
        await expect(this.page.locator('#game-section')).toBeVisible({ timeout: 15000 });
    }

    async buzz(): Promise<void> {
        await this.page.locator('#buzzer-button').click();
    }

    async isGameVisible(): Promise<void> {
        await expect(this.page.locator('#game-section')).toBeVisible();
    }

    async expectBuzzerReady(): Promise<void> {
        await expect(this.page.locator('#buzzer-button')).toHaveText(/JETZT BUZZERN/, { timeout: 15000 });
        await expect(this.page.locator('#buzzer-button')).toBeEnabled();
    }

    async expectBuzzerWaitingOrLocked(): Promise<void> {
        await expect(this.page.locator('#buzzer-button')).toHaveText(/WARTEN|GESPERRT/, { timeout: 15000 });
    }

    async waitForMapInterface(): Promise<void> {
        await expect(this.page.locator('#map-interface')).toBeVisible({ timeout: 15000 });
        await expect(this.page.locator('#player-map')).toBeVisible();
    }

    async selectMapPointAndSubmit(): Promise<void> {
        const map = this.page.locator('#player-map');
        const box = await map.boundingBox();
        if (!box) {
            throw new Error('player-map bounding box not available');
        }

        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(this.page.locator('#confirm-guess-btn')).toBeVisible();
        await this.page.locator('#confirm-guess-btn').click();
    }

    async waitForEstimateInterface(): Promise<void> {
        await expect(this.page.locator('#estimate-interface')).toBeVisible({ timeout: 15000 });
    }

    async submitEstimate(value: number): Promise<void> {
        await this.page.fill('#estimate-input', String(value));
        await this.page.locator('#submit-estimate-btn').click();
        await expect(this.page.locator('#estimate-wait-msg')).toBeVisible();
    }

    async waitForFreetextInterface(): Promise<void> {
        await expect(this.page.locator('#freetext-interface')).toBeVisible({ timeout: 15000 });
    }

    async submitFreetext(text: string): Promise<void> {
        await this.page.fill('#freetext-input', text);
        await this.page.locator('#submit-freetext-btn').click();
        await expect(this.page.locator('#freetext-wait-msg')).toBeVisible();
    }
}
