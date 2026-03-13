import http from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

type Player = {
    id: string;
    name: string;
    socketId: string;
};

type Session = {
    roomCode: string;
    gameId: string;
    hostSocketId: string;
    players: Record<string, Player>;
    activeCatIndex?: number;
    activeQIndex?: number;
};

const sessions: Record<string, Session> = {};

let httpServer: http.Server;
let io: Server;
let baseUrl = '';

function createRoomCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function waitForEvent<T = any>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeoutMs);

        socket.once(event, (data: T) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

describe('Socket.io Integration Tests', () => {
    beforeAll(async () => {
        httpServer = http.createServer();
        io = new Server(httpServer, {
            cors: { origin: '*' },
        });

        io.on('connection', (socket) => {
            socket.on('host_create_session', (gameId: string) => {
                const roomCode = createRoomCode();
                sessions[roomCode] = {
                    roomCode,
                    gameId,
                    hostSocketId: socket.id,
                    players: {},
                };

                socket.join(roomCode);
                socket.emit('session_created', {
                    roomCode,
                    gameId,
                    hostId: socket.id,
                });
            });

            socket.on('player_join_session', (roomCode: string, playerName: string) => {
                const session = sessions[roomCode];
                if (!session) {
                    socket.emit('error', { message: 'Session not found' });
                    return;
                }

                const playerId = `player-${Object.keys(session.players).length + 1}`;
                session.players[socket.id] = {
                    id: playerId,
                    name: playerName,
                    socketId: socket.id,
                };

                socket.join(roomCode);
                socket.emit('player_joined', {
                    playerId,
                    roomCode,
                });

                io.to(roomCode).emit('player_count_updated', {
                    count: Object.keys(session.players).length,
                });
            });

            socket.on('host_rejoin_session', (roomCode: string) => {
                const session = sessions[roomCode];
                if (!session) {
                    socket.emit('host_rejoin_error');
                    return;
                }

                session.hostSocketId = socket.id;
                socket.join(roomCode);
                socket.emit('host_session_restored', {
                    gameId: session.gameId,
                    catIndex: session.activeCatIndex ?? -1,
                    qIndex: session.activeQIndex ?? -1,
                    players: session.players,
                });
            });
        });

        await new Promise<void>((resolve) => {
            httpServer.listen(0, () => resolve());
        });

        const address = httpServer.address();
        if (!address || typeof address === 'string') {
            throw new Error('Could not determine test server port');
        }
        baseUrl = `http://localhost:${address.port}`;
    });

    afterEach(() => {
        for (const roomCode of Object.keys(sessions)) {
            delete sessions[roomCode];
        }
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => {
            io.close(() => resolve());
        });

        if (httpServer.listening) {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        }
    });

    it('should establish socket connection', async () => {
        const client = ioClient(baseUrl, {
            transports: ['websocket'],
        });

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Connect timeout')), 3000);
            client.once('connect', () => {
                clearTimeout(timer);
                resolve();
            });
            client.once('connect_error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        expect(client.connected).toBe(true);
        client.disconnect();
    });

    it('should create a session for host', async () => {
        const host = ioClient(baseUrl, {
            transports: ['websocket'],
        });
        await waitForEvent(host, 'connect');

        host.emit('host_create_session', 'game-123');
        const sessionCreated = await waitForEvent<{ roomCode: string; gameId: string; hostId: string }>(
            host,
            'session_created'
        );

        expect(sessionCreated.roomCode).toMatch(/^\d{4}$/);
        expect(sessionCreated.gameId).toBe('game-123');
        expect(sessionCreated.hostId).toBe(host.id);
        expect(sessions[sessionCreated.roomCode]).toBeDefined();

        host.disconnect();
    });

    it('should allow player join and notify room player count', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        host.emit('host_create_session', 'game-join-test');
        const sessionCreated = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        const hostCountPromise = waitForEvent<{ count: number }>(host, 'player_count_updated');
        player.emit('player_join_session', sessionCreated.roomCode, 'Alice');

        const joined = await waitForEvent<{ playerId: string; roomCode: string }>(player, 'player_joined');
        const hostCount = await hostCountPromise;

        expect(joined.roomCode).toBe(sessionCreated.roomCode);
        expect(joined.playerId).toMatch(/^player-\d+$/);
        expect(hostCount.count).toBe(1);

        host.disconnect();
        player.disconnect();
    });

    it('should reject joining non-existing session', async () => {
        const player = ioClient(baseUrl, {
            transports: ['websocket'],
        });
        await waitForEvent(player, 'connect');

        player.emit('player_join_session', '9999', 'Bob');
        const errorPayload = await waitForEvent<{ message: string }>(player, 'error');

        expect(errorPayload.message).toBe('Session not found');
        player.disconnect();
    });

    it('should restore active indexes when host rejoins session', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        host.emit('host_create_session', 'game-rejoin-test');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        sessions[created.roomCode].activeCatIndex = 2;
        sessions[created.roomCode].activeQIndex = 3;

        host.disconnect();

        const rejoinedHost = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(rejoinedHost, 'connect');

        rejoinedHost.emit('host_rejoin_session', created.roomCode);
        const restored = await waitForEvent<{ gameId: string; catIndex: number; qIndex: number }>(
            rejoinedHost,
            'host_session_restored'
        );

        expect(restored.gameId).toBe('game-rejoin-test');
        expect(restored.catIndex).toBe(2);
        expect(restored.qIndex).toBe(3);

        rejoinedHost.disconnect();
    });
});
