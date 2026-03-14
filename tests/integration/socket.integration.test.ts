import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { GameModel } from '../../src/models/Quiz';
import { mockGame } from '../fixtures/mock-data';
import { connectDatabase, io, server, sessions } from '../../src/server';

let mongoServer: MongoMemoryServer;
let baseUrl = '';
let gameId = '';

function waitForEvent<T = any>(socket: ClientSocket, event: string, timeoutMs = 7000): Promise<T> {
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

function waitForNoEvent(socket: ClientSocket, event: string, waitMs = 500): Promise<void> {
    return new Promise((resolve, reject) => {
        const handler = () => {
            clearTimeout(timer);
            socket.off(event, handler);
            reject(new Error(`Unexpected event received: ${event}`));
        };

        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve();
        }, waitMs);

        socket.on(event, handler);
    });
}

function waitForScores(
    socket: ClientSocket,
    predicate: (scores: Record<string, any>) => boolean,
    timeoutMs = 4000
): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
        const onScores = (scores: Record<string, any>) => {
            if (!predicate(scores)) return;
            clearTimeout(timer);
            socket.off('update_scores', onScores);
            resolve(scores);
        };

        const timer = setTimeout(() => {
            socket.off('update_scores', onScores);
            reject(new Error('Timeout waiting for matching update_scores event'));
        }, timeoutMs);

        socket.on('update_scores', onScores);
    });
}

async function createGameAndSession(host: ClientSocket): Promise<string> {
    const savedGame = await new GameModel(mockGame).save();
    gameId = savedGame._id!.toString();

    host.emit('host_create_session', gameId);
    const roomCode = await waitForEvent<string>(host, 'session_created');
    expect(roomCode).toMatch(/^\d{4}$/);
    return roomCode;
}

describe('Socket.io Integration Tests (Real Server)', () => {
    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();

        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
        }

        await connectDatabase(mongoUri);

        if (!server.listening) {
            await new Promise<void>((resolve) => {
                server.listen(0, () => resolve());
            });
        }

        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Could not determine test server port');
        }
        baseUrl = `http://localhost:${address.port}`;
    }, 30000);

    beforeEach(async () => {
        Object.keys(sessions).forEach((code) => delete sessions[code]);
        await GameModel.deleteMany({});
    });

    afterEach(async () => {
        io.sockets.sockets.forEach((socket) => socket.disconnect(true));
        await new Promise((resolve) => setTimeout(resolve, 20));
    });

    afterAll(async () => {
        Object.keys(sessions).forEach((code) => delete sessions[code]);

        await new Promise<void>((resolve) => {
            io.close(() => resolve());
        });

        if (server.listening) {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        }

        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
        }
        if (mongoServer) {
            await mongoServer.stop();
        }
    });

    it('should establish socket connection', async () => {
        const client = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(client, 'connect');

        expect(client.connected).toBe(true);
        client.disconnect();
    });

    it('should create session and store it in live server state', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        const roomCode = await createGameAndSession(host);

        expect(sessions[roomCode]).toBeDefined();
        expect(sessions[roomCode].gameId).toBe(gameId);
        expect(sessions[roomCode].hostSocketId).toBe(host.id);

        host.disconnect();
    });

    it('should allow player join and notify host via update_player_list', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        const hostListPromise = waitForEvent<Record<string, any>>(host, 'update_player_list');
        player.emit('player_join_session', { roomCode, name: 'Alice' });

        const join = await waitForEvent<{ playerId: string; roomCode: string; name: string }>(player, 'join_success');
        const hostList = await hostListPromise;

        expect(join.roomCode).toBe(roomCode);
        expect(join.name).toBe('Alice');
        expect(Object.keys(hostList)).toHaveLength(1);
        expect(hostList[join.playerId].name).toBe('Alice');

        host.disconnect();
        player.disconnect();
    });

    it('should pick deterministic chooser player when Math.random is mocked', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');

        // Consume the host controls update emitted by player A join to avoid stale-event races.
        await waitForEvent(host, 'update_host_controls');

        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        const controlsPromise = waitForEvent<{ chooserPlayerId?: string }>(host, 'update_host_controls');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        const controls = await controlsPromise;

        expect([joinA.playerId, joinB.playerId]).toContain(controls.chooserPlayerId);

        randomSpy.mockRestore();
        host.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should reject player join for unknown room', async () => {
        const player = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(player, 'connect');

        player.emit('player_join_session', { roomCode: '9999', name: 'Bob' });
        const msg = await waitForEvent<string>(player, 'join_error');

        expect(msg).toBe('Raum existiert nicht.');
        player.disconnect();
    });

    it('should reject board join for unknown room', async () => {
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(board, 'connect');

        board.emit('board_join_session', '9999');
        const msg = await waitForEvent<string>(board, 'error_message');

        expect(msg).toBe('Raum nicht gefunden.');
        board.disconnect();
    });

    it('should emit host_rejoin_error for unknown room', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        host.emit('host_rejoin_session', '0000');
        await expect(waitForEvent(host, 'host_rejoin_error')).resolves.toBeUndefined();

        host.disconnect();
    });

    it('should restore cat/q indexes and map resolve status on host rejoin', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        const roomCode = await createGameAndSession(host);

        const mapQuestion = {
            type: 'map' as const,
            points: 200,
            negativePoints: 0,
            questionText: 'Wo liegt Berlin?',
            answerText: 'Deutschland',
            location: {
                lat: 52.52,
                lng: 13.405,
                isCustomMap: false,
                customMapPath: '',
                mapWidth: 1000,
                mapHeight: 1000,
                radius: 50000,
            },
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const controlsPromise = waitForEvent(host, 'update_host_controls');
        host.emit('host_pick_question', { catIndex: 1, qIndex: 2, question: mapQuestion });
        await controlsPromise;

        host.emit('host_resolve_map');
        await waitForEvent(host, 'board_reveal_map_results');

        host.disconnect();

        const rejoinedHost = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(rejoinedHost, 'connect');

        rejoinedHost.emit('host_rejoin_session', roomCode);
        const restored = await waitForEvent<{
            gameId: string;
            catIndex: number;
            qIndex: number;
            isResolved?: boolean;
        }>(rejoinedHost, 'host_session_restored');

        expect(restored.gameId).toBe(gameId);
        expect(restored.catIndex).toBe(1);
        expect(restored.qIndex).toBe(2);
        expect(restored.isResolved).toBe(true);

        rejoinedHost.disconnect();
    });

    it('should ignore host_resolve_map when no map location is active', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const question = {
            type: 'standard' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Frage?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const boardShowPromise = waitForEvent(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        host.emit('host_resolve_map');
        await expect(waitForNoEvent(board, 'board_reveal_map_results')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
    });

    it('should ignore out-of-range elemination reveal index', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const question = {
            type: 'elemination' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Nenne Obstsorten',
            answerText: 'Apfel, Birne',
            listItems: ['Apfel', 'Birne'],
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const boardShowPromise = waitForEvent(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        host.emit('host_reveal_elemination_answer', 99);
        await expect(waitForNoEvent(board, 'board_reveal_elemination_answer')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should reveal remaining elemination answers and close via host_resolve_question', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(playerA, 'join_success');
        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        await waitForEvent(playerB, 'join_success');

        const question = {
            type: 'elemination' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Nenne Farben',
            answerText: 'Rot, Blau',
            listItems: ['Rot', 'Blau'],
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const boardShowPromise = waitForEvent(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        const firstRevealPromise = waitForEvent<number>(board, 'board_reveal_elemination_answer');
        host.emit('host_reveal_elemination_answer', 0);
        expect(await firstRevealPromise).toBe(0);

        const finalRevealPromise = waitForEvent<number>(board, 'board_reveal_elemination_answer', 7000);
        const hidePromise = waitForEvent(board, 'board_hide_question', 7000);
        host.emit('host_resolve_question');

        expect(await finalRevealPromise).toBe(1);
        await hidePromise;

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should set current player and broadcast turn to all clients', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent<{ playerId: string }>(playerA, 'join_success');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');

        const hostTurn = waitForEvent<{ id: string; name: string }>(host, 'player_won_buzz');
        const boardTurn = waitForEvent<{ id: string; name: string }>(board, 'player_won_buzz');
        const playerATurn = waitForEvent<{ id: string; name: string }>(playerA, 'player_won_buzz');
        const playerBTurn = waitForEvent<{ id: string; name: string }>(playerB, 'player_won_buzz');

        host.emit('host_set_current_player', joinedB.playerId);

        await expect(hostTurn).resolves.toEqual({ id: joinedB.playerId, name: 'Bob' });
        await expect(boardTurn).resolves.toEqual({ id: joinedB.playerId, name: 'Bob' });
        await expect(playerATurn).resolves.toEqual({ id: joinedB.playerId, name: 'Bob' });
        await expect(playerBTurn).resolves.toEqual({ id: joinedB.playerId, name: 'Bob' });

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should ignore host_set_current_player for unknown id', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        host.emit('host_set_current_player', 'does-not-exist');

        await expect(waitForNoEvent(host, 'player_won_buzz')).resolves.toBeUndefined();
        await expect(waitForNoEvent(board, 'player_won_buzz')).resolves.toBeUndefined();
        await expect(waitForNoEvent(player, 'player_won_buzz')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should ignore host_set_current_player for inactive player', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(playerA, 'join_success');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');

        playerB.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));

        host.emit('host_set_current_player', joinedB.playerId);
        await expect(waitForNoEvent(host, 'player_won_buzz')).resolves.toBeUndefined();

        host.disconnect();
        playerA.disconnect();
    });

    it('should restore existing player by existingPlayerId on rejoin', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const firstJoin = await waitForEvent<{ playerId: string; roomCode: string; name: string }>(player, 'join_success');

        player.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const rejoinPlayer = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(rejoinPlayer, 'connect');

        const listPromise = waitForEvent<Record<string, any>>(host, 'update_player_list');
        rejoinPlayer.emit('player_join_session', {
            roomCode,
            name: 'Alice2',
            existingPlayerId: firstJoin.playerId,
        });

        const secondJoin = await waitForEvent<{ playerId: string; roomCode: string; name: string }>(rejoinPlayer, 'join_success');
        const list = await listPromise;

        expect(secondJoin.playerId).toBe(firstJoin.playerId);
        expect(secondJoin.name).toBe('Alice');
        expect(list[firstJoin.playerId].active).toBe(true);

        host.disconnect();
        rejoinPlayer.disconnect();
    });

    it('should close active standard question on host_close_question', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const question = {
            type: 'standard' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Frage?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const boardShowPromise = waitForEvent(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        const hidePromise = waitForEvent(board, 'board_hide_question');
        host.emit('host_close_question');
        await hidePromise;

        host.disconnect();
        board.disconnect();
    });

    it('should end session and remove room state', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const endedPromise = waitForEvent(board, 'session_ended');
        host.emit('host_end_session');
        await endedPromise;

        expect(sessions[roomCode]).toBeUndefined();

        host.disconnect();
        board.disconnect();
    });

    it('should run elemination round and award last remaining player', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');

        const question = {
            type: 'elemination' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Nenne Obstsorten',
            answerText: 'Apfel, Birne',
            listItems: ['Apfel', 'Birne'],
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        const firstTurnPromise = waitForEvent<{ id: string; name: string }>(host, 'player_won_buzz');
        const boardShowPromise = waitForEvent(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        const firstTurn = await firstTurnPromise;
        const eliminatedId = firstTurn.id;
        const remainingId = eliminatedId === joinedA.playerId ? joinedB.playerId : joinedA.playerId;

        host.emit('host_score_answer', { action: 'incorrect', playerId: eliminatedId });

        const scoreUpdate = await waitForScores(
            host,
            (scores) =>
                !!scores[eliminatedId]
                && !!scores[remainingId]
                && scores[eliminatedId].score === 0
                && scores[remainingId].score === 100,
            7000
        );
        await waitForEvent(board, 'board_hide_question', 7000);

        expect(scoreUpdate[eliminatedId].score).toBe(0);
        expect(scoreUpdate[remainingId].score).toBe(100);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should apply manual score update from host and broadcast new scores', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');

        // Flush initial score broadcast caused by player join.
        await waitForEvent(host, 'update_scores');

        host.emit('host_manual_score_update', { playerId: join.playerId, newScore: 321 });
        const scoreUpdate = await waitForScores(host, (scores) => scores[join.playerId]?.score === 321);

        expect(scoreUpdate[join.playerId].score).toBe(321);
        expect(sessions[roomCode].players[join.playerId].score).toBe(321);

        host.disconnect();
        player.disconnect();
    });

    it('should ignore manual score update for unknown player id', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        await createGameAndSession(host);

        host.emit('host_manual_score_update', { playerId: 'does-not-exist', newScore: 999 });
        await expect(waitForNoEvent(host, 'update_scores')).resolves.toBeUndefined();

        host.disconnect();
    });

    it('should ignore manual score update from non-host socket', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');

        // Flush initial score broadcast caused by player join.
        await waitForEvent(host, 'update_scores');

        player.emit('host_manual_score_update', { playerId: join.playerId, newScore: 777 });
        await expect(waitForNoEvent(host, 'update_scores')).resolves.toBeUndefined();

        expect(sessions[roomCode].players[join.playerId].score).toBe(0);

        host.disconnect();
        player.disconnect();
    });

    it('should show podium sorted by score descending', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');
        await waitForEvent(host, 'update_scores');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        await waitForEvent(host, 'update_scores');

        host.emit('host_manual_score_update', { playerId: joinA.playerId, newScore: 50 });
        await waitForScores(host, (scores) => scores[joinA.playerId]?.score === 50);

        host.emit('host_manual_score_update', { playerId: joinB.playerId, newScore: 200 });
        await waitForScores(host, (scores) => scores[joinB.playerId]?.score === 200);

        const podiumPromise = waitForEvent<Array<{ id: string; name: string; score: number }>>(board, 'board_show_podium');
        host.emit('host_show_podium');
        const podium = await podiumPromise;

        expect(podium[0].id).toBe(joinB.playerId);
        expect(podium[0].score).toBe(200);
        expect(podium[1].id).toBe(joinA.playerId);
        expect(podium[1].score).toBe(50);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should forward host media control command to board clients', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const payload = { action: 'seek', currentTime: 42.5 };
        const boardMediaPromise = waitForEvent<{ action: string; currentTime: number }>(board, 'board_media_control');

        host.emit('host_media_control', payload);
        await expect(boardMediaPromise).resolves.toEqual(payload);

        host.disconnect();
        board.disconnect();
    });

    it('should block non-host media control', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const payload = { action: 'pause', currentTime: 13 };
        const boardMediaPromise = waitForNoEvent(board, 'board_media_control');

        player.emit('host_media_control', payload);
        await expect(boardMediaPromise).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from ending a session', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        player.emit('host_end_session');

        await expect(waitForNoEvent(board, 'session_ended')).resolves.toBeUndefined();
        expect(sessions[roomCode]).toBeDefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from controlling pixel puzzle', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        player.emit('host_control_pixel_puzzle', 'next');
        await expect(waitForNoEvent(board, 'board_control_pixel_puzzle')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from toggling QR on board', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        player.emit('host_toggle_qr');
        await expect(waitForNoEvent(board, 'board_toggle_qr')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from picking a question', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const question = {
            type: 'standard' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Frage?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        player.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await expect(waitForNoEvent(board, 'board_show_question')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from resolving map results', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const mapQuestion = {
            type: 'map' as const,
            points: 200,
            negativePoints: 0,
            questionText: 'Wo liegt Berlin?',
            answerText: 'Deutschland',
            location: {
                lat: 52.52,
                lng: 13.405,
                isCustomMap: false,
                customMapPath: '',
                mapWidth: 1000,
                mapHeight: 1000,
                radius: 50000,
            },
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: mapQuestion });
        await waitForEvent(board, 'board_show_question');

        player.emit('player_submit_map_guess', { lat: 52.5, lng: 13.4 });
        player.emit('host_resolve_map');

        await expect(waitForNoEvent(board, 'board_reveal_map_results')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from scoring an answer', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');
        await waitForEvent(host, 'update_scores');

        const question = {
            type: 'standard' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Frage?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await waitForEvent(board, 'board_show_question');

        player.emit('host_score_answer', { action: 'correct', playerId: join.playerId });
        await expect(waitForNoEvent(host, 'update_scores')).resolves.toBeUndefined();
        expect(sessions[roomCode].players[join.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should block non-host from closing the active question', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const question = {
            type: 'standard' as const,
            points: 100,
            negativePoints: 0,
            questionText: 'Frage?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await waitForEvent(board, 'board_show_question');

        player.emit('host_close_question');
        await expect(waitForNoEvent(board, 'board_hide_question')).resolves.toBeUndefined();
        expect(sessions[roomCode].activeQuestion).not.toBeNull();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should load game on host via host_start_game', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        await waitForEvent(host, 'connect');

        await createGameAndSession(host);

        const loadPromise = waitForEvent<{ _id: string; title: string }>(host, 'load_game_on_host');
        host.emit('host_start_game', gameId);
        const loaded = await loadPromise;

        expect(loaded._id).toBe(gameId);
        expect(loaded.title).toBe(mockGame.title);

        host.disconnect();
    });

    it('should block non-host from host_start_game', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        player.emit('host_start_game', gameId);
        await expect(waitForNoEvent(player, 'load_game_on_host')).resolves.toBeUndefined();

        host.disconnect();
        player.disconnect();
    });

    it('should advance intro flow from title to categories to end', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const intro1 = waitForEvent<{ text: string; type: string }>(board, 'board_show_intro');
        host.emit('host_next_intro');
        await expect(intro1).resolves.toMatchObject({ type: 'title', text: mockGame.title });

        const intro2 = waitForEvent<{ text: string; type: string }>(board, 'board_show_intro');
        host.emit('host_next_intro');
        await expect(intro2).resolves.toMatchObject({ type: 'category', text: mockGame.categories[0].name });

        const intro3 = waitForEvent<{ text: string; type: string }>(board, 'board_show_intro');
        host.emit('host_next_intro');
        await expect(intro3).resolves.toMatchObject({ type: 'category', text: mockGame.categories[1].name });

        const intro4 = waitForEvent<{ text: string; type: string }>(board, 'board_show_intro');
        host.emit('host_next_intro');
        await expect(intro4).resolves.toMatchObject({ type: 'end', text: '' });

        host.disconnect();
        board.disconnect();
    });

    it('should resolve estimate guesses, sort by diff and award winners', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');
        await waitForEvent(host, 'update_scores');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        await waitForEvent(host, 'update_scores');

        const estimateQuestion = {
            type: 'estimate' as const,
            points: 300,
            negativePoints: 0,
            questionText: 'Wie viele Menschen leben auf der Erde?',
            answerText: '~8 Milliarden',
            estimationAnswer: 100,
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: estimateQuestion });
        await waitForEvent(board, 'board_show_question');

        playerA.emit('player_submit_estimate', 101);
        playerB.emit('player_submit_estimate', 108);

        const resultPromise = waitForEvent<{ correctAnswer: number; guesses: Array<{ playerId: string; diff: number; isWinner: boolean }> }>(
            board,
            'board_reveal_estimate_results'
        );
        const scoresPromise = waitForScores(host, (s) => s[joinA.playerId]?.score === 300 && s[joinB.playerId]?.score === 0);
        host.emit('host_resolve_estimate');
        const result = await resultPromise;

        expect(result.correctAnswer).toBe(100);
        expect(result.guesses[0].playerId).toBe(joinA.playerId);
        expect(result.guesses[0].isWinner).toBe(true);
        expect(result.guesses[1].playerId).toBe(joinB.playerId);
        expect(result.guesses[1].isWinner).toBe(false);

        const scores = await scoresPromise;
        expect(scores[joinA.playerId].score).toBe(300);
        expect(scores[joinB.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should block non-host from resolving estimate', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);

        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        await waitForEvent(player, 'join_success');

        const estimateQuestion = {
            type: 'estimate' as const,
            points: 300,
            negativePoints: 0,
            questionText: 'Wie viele Menschen leben auf der Erde?',
            answerText: '~8 Milliarden',
            estimationAnswer: 100,
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: estimateQuestion });
        await waitForEvent(board, 'board_show_question');

        player.emit('host_resolve_estimate');
        await expect(waitForNoEvent(board, 'board_reveal_estimate_results')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should resolve map using radius and award players within radius', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');
        await waitForEvent(host, 'update_scores');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        await waitForEvent(host, 'update_scores');

        const mapQuestion = {
            type: 'map' as const,
            points: 200,
            negativePoints: 0,
            questionText: 'Radius-Test',
            answerText: 'Zentrum',
            location: {
                lat: 52.52,
                lng: 13.405,
                isCustomMap: false,
                customMapPath: '',
                mapWidth: 1000,
                mapHeight: 1000,
                radius: 1000,
            },
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: mapQuestion });
        await waitForEvent(board, 'board_show_question');

        playerA.emit('player_submit_map_guess', { lat: 52.5205, lng: 13.4055 }); // inside radius
        playerB.emit('player_submit_map_guess', { lat: 52.7, lng: 13.9 }); // outside radius

        const boardResultPromise = waitForEvent<{ results: Record<string, { isWinner: boolean }> }>(board, 'board_reveal_map_results');
        const scoresPromise = waitForScores(host, (s) => s[joinA.playerId]?.score === 200 && s[joinB.playerId]?.score === 0);

        host.emit('host_resolve_map');

        const boardResult = await boardResultPromise;
        const scores = await scoresPromise;

        expect(boardResult.results[joinA.playerId].isWinner).toBe(true);
        expect(boardResult.results[joinB.playerId].isWinner).toBe(false);
        expect(scores[joinA.playerId].score).toBe(200);
        expect(scores[joinB.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should resolve map using polygon zone and award inside players', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');
        await waitForEvent(host, 'update_scores');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        await waitForEvent(host, 'update_scores');

        const mapQuestion = {
            type: 'map' as const,
            points: 150,
            negativePoints: 0,
            questionText: 'Polygon-Test',
            answerText: 'Zone',
            location: {
                lat: 0,
                lng: 0,
                isCustomMap: true,
                customMapPath: '',
                mapWidth: 1000,
                mapHeight: 1000,
                radius: 0,
                zone: [
                    { lat: 0, lng: 0 },
                    { lat: 0, lng: 10 },
                    { lat: 10, lng: 10 },
                    { lat: 10, lng: 0 },
                ],
            },
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: mapQuestion });
        await waitForEvent(board, 'board_show_question');

        playerA.emit('player_submit_map_guess', { lat: 5, lng: 5 }); // inside polygon
        playerB.emit('player_submit_map_guess', { lat: 25, lng: 25 }); // outside polygon

        const boardResultPromise = waitForEvent<{ results: Record<string, { isWinner: boolean }> }>(board, 'board_reveal_map_results');
        const scoresPromise = waitForScores(host, (s) => s[joinA.playerId]?.score === 150 && s[joinB.playerId]?.score === 0);

        host.emit('host_resolve_map');

        const boardResult = await boardResultPromise;
        const scores = await scoresPromise;

        expect(boardResult.results[joinA.playerId].isWinner).toBe(true);
        expect(boardResult.results[joinB.playerId].isWinner).toBe(false);
        expect(scores[joinA.playerId].score).toBe(150);
        expect(scores[joinB.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should resolve estimate with tie and award both closest players', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', { roomCode, name: 'Alice' });
        const joinA = await waitForEvent<{ playerId: string }>(playerA, 'join_success');
        await waitForEvent(host, 'update_scores');

        playerB.emit('player_join_session', { roomCode, name: 'Bob' });
        const joinB = await waitForEvent<{ playerId: string }>(playerB, 'join_success');
        await waitForEvent(host, 'update_scores');

        const estimateQuestion = {
            type: 'estimate' as const,
            points: 120,
            negativePoints: 0,
            questionText: 'Tie-Test',
            answerText: '100',
            estimationAnswer: 100,
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: estimateQuestion });
        await waitForEvent(board, 'board_show_question');

        playerA.emit('player_submit_estimate', 99);
        playerB.emit('player_submit_estimate', 101);

        const resultPromise = waitForEvent<{ guesses: Array<{ playerId: string; isWinner: boolean }> }>(board, 'board_reveal_estimate_results');
        const scoresPromise = waitForScores(host, (s) => s[joinA.playerId]?.score === 120 && s[joinB.playerId]?.score === 120);
        host.emit('host_resolve_estimate');

        const result = await resultPromise;
        const scores = await scoresPromise;

        const winners = result.guesses.filter((g) => g.isWinner).map((g) => g.playerId);
        expect(winners).toContain(joinA.playerId);
        expect(winners).toContain(joinB.playerId);
        expect(scores[joinA.playerId].score).toBe(120);
        expect(scores[joinB.playerId].score).toBe(120);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should ignore estimate resolve when no estimationAnswer is set', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const badEstimateQuestion = {
            type: 'estimate' as const,
            points: 200,
            negativePoints: 0,
            questionText: 'Ohne Antwort',
            answerText: 'n/a',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question: badEstimateQuestion });
        await waitForEvent(board, 'board_show_question');

        host.emit('host_resolve_estimate');
        await expect(waitForNoEvent(board, 'board_reveal_estimate_results')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
    });

    it('should forward host_toggle_qr to board clients', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const togglePromise = waitForEvent(board, 'board_toggle_qr');
        host.emit('host_toggle_qr');
        await expect(togglePromise).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
    });

    it('should forward host_control_pixel_puzzle to board clients', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const action = 'next';
        const controlPromise = waitForEvent<string>(board, 'board_control_pixel_puzzle');
        host.emit('host_control_pixel_puzzle', action);
        await expect(controlPromise).resolves.toBe(action);

        host.disconnect();
        board.disconnect();
    });

    it('should collect freetext answers and reveal them on host resolve', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');
        await waitForEvent(host, 'update_scores');

        const freetextQuestion = {
            type: 'freetext' as const,
            points: 150,
            negativePoints: 0,
            questionText: 'Wie heißt der längste Fluss Europas?',
            answerText: 'Wolga',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 1, qIndex: 0, question: freetextQuestion });
        await waitForEvent(board, 'board_show_question');

        const statusPromise = waitForEvent<{ submittedCount: number; totalPlayers: number }>(host, 'host_update_estimate_status');
        player.emit('player_submit_freetext', 'Wolga');
        await expect(statusPromise).resolves.toMatchObject({ submittedCount: 1, totalPlayers: 1 });

        const revealPromise = waitForEvent<{ answers: Array<{ playerId: string; name: string; text: string; status?: string }> }>(
            board,
            'board_show_freetext_results'
        );
        host.emit('host_resolve_freetext');
        const reveal = await revealPromise;

        expect(reveal.answers).toHaveLength(1);
        expect(reveal.answers[0]).toMatchObject({ playerId: join.playerId, name: 'Alice', text: 'Wolga' });

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should forward music_control within the room', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        const payload = { action: 'play', time: 10 };
        const musicPromise = waitForEvent<{ action: string; time: number }>(board, 'music_control');

        host.emit('music_control', payload);
        await expect(musicPromise).resolves.toEqual(payload);

        host.disconnect();
        board.disconnect();
    });

    it('should toggle freetext score state when same action is applied twice', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');
        await waitForEvent(host, 'update_scores');

        const freetextQuestion = {
            type: 'freetext' as const,
            points: 150,
            negativePoints: 0,
            questionText: 'Freitext?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 1, qIndex: 0, question: freetextQuestion });
        await waitForEvent(board, 'board_show_question');

        const scoresPlusPromise = waitForScores(host, (s) => s[join.playerId]?.score === 150);
        host.emit('host_score_answer', { action: 'correct', playerId: join.playerId });
        await scoresPlusPromise;

        const scoresResetPromise = waitForScores(host, (s) => s[join.playerId]?.score === 0);
        host.emit('host_score_answer', { action: 'correct', playerId: join.playerId });
        const resetScores = await scoresResetPromise;

        expect(resetScores[join.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should remove previous freetext points when switching from correct to incorrect', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        const roomCode = await createGameAndSession(host);
        board.emit('board_join_session', roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', { roomCode, name: 'Alice' });
        const join = await waitForEvent<{ playerId: string }>(player, 'join_success');
        await waitForEvent(host, 'update_scores');

        const freetextQuestion = {
            type: 'freetext' as const,
            points: 200,
            negativePoints: 0,
            questionText: 'Freitext?',
            answerText: 'Antwort',
            mediaPath: '',
            hasMedia: false,
            mediaType: 'none' as const,
            answerMediaPath: '',
            hasAnswerMedia: false,
            answerMediaType: 'none' as const,
        };

        host.emit('host_pick_question', { catIndex: 1, qIndex: 0, question: freetextQuestion });
        await waitForEvent(board, 'board_show_question');

        const scoresCorrectPromise = waitForScores(host, (s) => s[join.playerId]?.score === 200);
        host.emit('host_score_answer', { action: 'correct', playerId: join.playerId });
        await scoresCorrectPromise;

        const scoresIncorrectPromise = waitForScores(host, (s) => s[join.playerId]?.score === 0);
        host.emit('host_score_answer', { action: 'incorrect', playerId: join.playerId });
        const finalScores = await scoresIncorrectPromise;

        expect(finalScores[join.playerId].score).toBe(0);

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });
});
