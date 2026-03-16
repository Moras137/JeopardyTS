const fs = require('fs');
const path = require('path');

class TestProtocolReporter {
    constructor(options = {}) {
        this.options = options;
        this.results = [];
        this.startedAt = null;
        this.outputDir = options.outputDir || path.resolve(process.cwd(), 'output', 'playwright-report');
    }

    onBegin(config, suite) {
        this.startedAt = new Date();
        this.total = suite.allTests().length;
        fs.mkdirSync(this.outputDir, { recursive: true });
    }

    onTestEnd(test, result) {
        const filePath = test.location ? path.relative(process.cwd(), test.location.file) : 'unknown';
        const title = test.titlePath().slice(1).join(' > ');
        const firstError = result.errors && result.errors.length > 0 ? (result.errors[0].message || 'Unknown error') : '';

        this.results.push({
            title,
            file: filePath,
            status: result.status,
            durationMs: result.duration,
            retry: result.retry,
            error: firstError,
        });
    }

    async onEnd(fullResult) {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - this.startedAt.getTime();

        const stats = {
            total: this.total,
            passed: this.results.filter((r) => r.status === 'passed').length,
            failed: this.results.filter((r) => r.status === 'failed').length,
            skipped: this.results.filter((r) => r.status === 'skipped').length,
            timedOut: this.results.filter((r) => r.status === 'timedOut').length,
            interrupted: this.results.filter((r) => r.status === 'interrupted').length,
            flaky: this.results.filter((r) => r.status === 'flaky').length,
        };

        const protocolJson = {
            run: {
                status: fullResult.status,
                startedAt: this.startedAt.toISOString(),
                finishedAt: finishedAt.toISOString(),
                durationMs,
            },
            stats,
            tests: this.results,
        };

        const jsonPath = path.join(this.outputDir, 'test-protokoll.json');
        fs.writeFileSync(jsonPath, JSON.stringify(protocolJson, null, 2), 'utf8');

        const lines = [];
        lines.push('# E2E Testprotokoll');
        lines.push('');
        lines.push(`- Status: ${fullResult.status}`);
        lines.push(`- Start: ${this.startedAt.toISOString()}`);
        lines.push(`- Ende: ${finishedAt.toISOString()}`);
        lines.push(`- Dauer: ${(durationMs / 1000).toFixed(2)}s`);
        lines.push(`- Gesamt: ${stats.total}`);
        lines.push(`- Passed: ${stats.passed}`);
        lines.push(`- Failed: ${stats.failed}`);
        lines.push(`- Skipped: ${stats.skipped}`);
        lines.push(`- TimedOut: ${stats.timedOut}`);
        lines.push(`- Flaky: ${stats.flaky}`);
        lines.push('');
        lines.push('## Details');
        lines.push('');
        lines.push('| Status | Dauer (ms) | Datei | Test | Fehler |');
        lines.push('|---|---:|---|---|---|');

        for (const entry of this.results) {
            const errorText = entry.error ? entry.error.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|') : '';
            lines.push(`| ${entry.status} | ${entry.durationMs} | ${entry.file} | ${entry.title.replace(/\|/g, '\\|')} | ${errorText} |`);
        }

        const mdPath = path.join(this.outputDir, 'test-protokoll.md');
        fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    }
}

module.exports = TestProtocolReporter;
