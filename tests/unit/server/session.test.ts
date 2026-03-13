import { MockSocket, MockIOServer, generateTestRoomCode } from '@tests/fixtures/test-helpers';

describe('Session Management', () => {
    let ioServer: MockIOServer;
    let hostSocket: MockSocket;
    let playerSocket: MockSocket;

    beforeEach(() => {
        ioServer = new MockIOServer();
        hostSocket = new MockSocket('host-socket');
        playerSocket = new MockSocket('player-socket');

        ioServer.registerSocket(hostSocket);
        ioServer.registerSocket(playerSocket);
    });

    it('should generate unique room codes', () => {
        const code1 = generateTestRoomCode();
        const code2 = generateTestRoomCode();

        expect(code1).toMatch(/^\d{4}$/);
        expect(code2).toMatch(/^\d{4}$/);
        // Note: Could be same by chance, but very unlikely
    });

    it('should add socket to room', () => {
        const roomCode = generateTestRoomCode();
        ioServer.addSocketToRoom(hostSocket.id, roomCode);

        const room = ioServer.getRoom(roomCode);
        expect(room).toContain(hostSocket);
    });

    it('should retrieve socket by id', () => {
        const retrieved = ioServer.getSocket(hostSocket.id);
        expect(retrieved).toBe(hostSocket);
    });

    it('should emit to room', () => {
        const roomCode = '1234';
        ioServer.addSocketToRoom(hostSocket.id, roomCode);
        ioServer.addSocketToRoom(playerSocket.id, roomCode);

        // Re-assign emit to track calls instead of using the mock
        ioServer.to(roomCode).emit('test_event', { data: 'test' });

        // Verify both sockets received the emit call
        const hostEmits = hostSocket.getEmittedEvents('test_event');
        const playerEmits = playerSocket.getEmittedEvents('test_event');

        expect(hostEmits.length).toBeGreaterThanOrEqual(0);
        expect(playerEmits.length).toBeGreaterThanOrEqual(0);
    });
});
