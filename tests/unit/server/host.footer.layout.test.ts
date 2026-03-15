import fs from 'fs';
import path from 'path';

describe('Host Footer Layout Regression', () => {
    const hostHtmlPath = path.resolve(process.cwd(), 'frontend/host.html');
    const html = fs.readFileSync(hostHtmlPath, 'utf-8');

    it('should keep resolve button and buzz grading section in modal footer', () => {
        expect(html).toMatch(/<div class="modal-footer">[\s\S]*id="resolve-question-btn"[\s\S]*id="buzz-winner-section"[\s\S]*<\/div>/);
    });

    it('should label buzz winner text and include both grading buttons', () => {
        expect(html).toContain('Antwort von');
        expect(html).toMatch(/id="buzz-winner-section"[\s\S]*id="correct-btn"[\s\S]*id="incorrect-btn"/);
    });

    it('should keep unlock control text as "Buzzer freigeben"', () => {
        expect(html).toContain('id="unlock-buzzers-btn"');
        expect(html).toContain('Buzzer freigeben');
    });
});
