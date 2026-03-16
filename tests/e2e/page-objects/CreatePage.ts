import { expect, type Locator, type Page } from '@playwright/test';

export class CreatePage {
    constructor(private readonly page: Page, private readonly baseUrl: string) {}

    private static readonly tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQw7O5kAAAAASUVORK5CYII=';

    private static readonly tinyWavBase64 =
        'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

    async goto(): Promise<void> {
        await this.page.goto(`${this.baseUrl}/create.html`);
        await expect(this.page.locator('#quiz-dashboard')).toBeVisible();
    }

    dashboardTileByTitle(title: string): Locator {
        return this.page.locator('.quiz-tile').filter({ has: this.page.locator('.tile-title', { hasText: title }) });
    }

    async openEditorFromTile(title: string): Promise<void> {
        const tile = this.dashboardTileByTitle(title).first();
        await expect(tile).toBeVisible();
        await tile.locator('.btn-edit').click();
        await expect(this.page.locator('#quiz-editor')).toBeVisible();
    }

    async startPlayFromTile(title: string): Promise<void> {
        const tile = this.dashboardTileByTitle(title).first();
        await expect(tile).toBeVisible();
        await tile.locator('.btn-play').click();
    }

    async exportFromTile(title: string): Promise<void> {
        const tile = this.dashboardTileByTitle(title).first();
        await expect(tile).toBeVisible();
        await tile.locator('.btn-export').click();
    }

    async deleteFromTile(title: string): Promise<void> {
        const tile = this.dashboardTileByTitle(title).first();
        await expect(tile).toBeVisible();
        await tile.locator('.btn-del').click();
    }

    async createSimpleQuiz(title: string, questionText: string, answerText: string): Promise<void> {
        await this.page.locator('#btn-dashboard-new').click();
        await expect(this.page.locator('#quiz-editor')).toBeVisible();

        await this.page.fill('#numCategories', '1');
        await this.page.dispatchEvent('#numCategories', 'change');
        await this.page.fill('#numQuestions', '1');
        await this.page.dispatchEvent('#numQuestions', 'change');

        await this.page.fill('#gameTitle', title);
        await this.page.locator('.question-block .q-text').first().fill(questionText);
        await this.page.locator('.question-block .q-answer').first().fill(answerText);
        await this.page.click('#btn-save');
    }

    async saveEditedTitle(newTitle: string): Promise<void> {
        await this.page.fill('#gameTitle', newTitle);
        await this.page.click('#btn-save');
    }

    async switchToBoardPreview(): Promise<void> {
        await this.page.locator('#btn-view-board').click();
        await expect(this.page.locator('#preview-grid')).toBeVisible();
    }

    async switchToListView(): Promise<void> {
        await this.page.locator('#btn-view-list').click();
        await expect(this.page.locator('#categories-container')).toBeVisible();
    }

    async openSidebar(): Promise<void> {
        for (let i = 0; i < 3; i += 1) {
            const visible = await this.page.locator('#sidebar').isVisible().catch(() => false);
            if (visible) {
                break;
            }
            await this.page.locator('#sidebar-toggle-btn').click();
        }
        await expect(this.page.locator('#sidebar')).toBeVisible();
    }

    async searchDashboard(term: string): Promise<void> {
        await this.page.fill('#dashboard-search', term);
    }

    async searchSidebar(term: string): Promise<void> {
        await this.page.fill('#sidebar-search', term);
    }

    boardCards(): Locator {
        return this.page.locator('#preview-grid .preview-card');
    }

    boardHeaders(): Locator {
        return this.page.locator('#preview-grid .preview-cat-header');
    }

    async clickAnleitung(): Promise<void> {
        await this.page.locator('a[href="/anleitung.html"]').click();
    }

    async importBundle(absoluteZipPath: string): Promise<void> {
        await this.page.locator('#import-bundle-input').setInputFiles(absoluteZipPath);
    }

    async uploadBoardBackgroundVirtualFile(): Promise<void> {
        await this.page.locator('#boardBackgroundUpload').setInputFiles({
            name: 'board.png',
            mimeType: 'image/png',
            buffer: Buffer.from(CreatePage.tinyPngBase64, 'base64'),
        });
    }

    async uploadBackgroundMusicVirtualFile(): Promise<void> {
        await this.page.locator('#backgroundMusicUpload').setInputFiles({
            name: 'music.wav',
            mimeType: 'audio/wav',
            buffer: Buffer.from(CreatePage.tinyWavBase64, 'base64'),
        });
    }

    async dropVirtualImageOnZone(zoneSelector: string): Promise<void> {
        await this.dropVirtualFileOnZone(zoneSelector, 'drop.png', 'image/png', CreatePage.tinyPngBase64);
    }

    async dropVirtualAudioOnZone(zoneSelector: string): Promise<void> {
        await this.dropVirtualFileOnZone(zoneSelector, 'drop.wav', 'audio/wav', CreatePage.tinyWavBase64);
    }

    private async dropVirtualFileOnZone(
        zoneSelector: string,
        name: string,
        mimeType: string,
        base64: string
    ): Promise<void> {
        const dataTransfer = await this.page.evaluateHandle(({ fileName, type, base64Content }) => {
            const dt = new DataTransfer();
            const bytes = Uint8Array.from(atob(base64Content), (char) => char.charCodeAt(0));
            const file = new File([bytes], fileName, { type });
            dt.items.add(file);
            return dt;
        }, { fileName: name, type: mimeType, base64Content: base64 });

        await this.page.dispatchEvent(zoneSelector, 'dragenter', { dataTransfer });
        await this.page.dispatchEvent(zoneSelector, 'dragover', { dataTransfer });
        await this.page.dispatchEvent(zoneSelector, 'drop', { dataTransfer });
    }
}
