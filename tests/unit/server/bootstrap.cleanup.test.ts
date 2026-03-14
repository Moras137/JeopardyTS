import { bootstrapServer, runCleanupUnusedFilesSafely } from '../../../src/server';

describe('Bootstrap and Cleanup Runner', () => {
    it('should skip bootstrap actions in test environment', async () => {
        const connectMock = jest.fn().mockResolvedValue(undefined);
        const startMock = jest.fn();

        bootstrapServer('test', connectMock, startMock);

        expect(connectMock).not.toHaveBeenCalled();
        expect(startMock).not.toHaveBeenCalled();
    });

    it('should execute bootstrap actions outside test environment', async () => {
        const connectMock = jest.fn().mockResolvedValue(undefined);
        const startMock = jest.fn();

        bootstrapServer('production', connectMock, startMock);

        expect(connectMock).toHaveBeenCalledTimes(1);
        expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('should tolerate connect errors in bootstrap', async () => {
        const connectMock = jest.fn().mockRejectedValue(new Error('db down'));
        const startMock = jest.fn();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        bootstrapServer('production', connectMock, startMock);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(startMock).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('should rerun cleanup if a second request arrives while running', async () => {
        let resolveFirst: (() => void) | null = null;
        const cleanupMock = jest
            .fn<Promise<void>, []>()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce(undefined);

        const firstRun = runCleanupUnusedFilesSafely(cleanupMock);
        await new Promise((resolve) => setTimeout(resolve, 0));

        await runCleanupUnusedFilesSafely(cleanupMock);
        expect(cleanupMock).toHaveBeenCalledTimes(1);

        if (!resolveFirst) throw new Error('resolveFirst not set');
        resolveFirst();
        await firstRun;

        expect(cleanupMock).toHaveBeenCalledTimes(2);
    });

    it('should reset internal running state after cleanup error', async () => {
        const failingCleanup = jest.fn().mockRejectedValueOnce(new Error('cleanup failed'));
        await expect(runCleanupUnusedFilesSafely(failingCleanup)).rejects.toThrow('cleanup failed');

        const okCleanup = jest.fn().mockResolvedValue(undefined);
        await expect(runCleanupUnusedFilesSafely(okCleanup)).resolves.toBeUndefined();
        expect(okCleanup).toHaveBeenCalledTimes(1);
    });
});
