import http from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

type Player = {
    id: string;
    name: string;
    socketId: string;
    score: number;
};

type Session = {
    roomCode: string;
    gameId: string;
    hostSocketId: string;
    players: Record<string, Player>;
    activeCatIndex?: number;
    activeQIndex?: number;
    buzzersActive: boolean;
    currentBuzzWinnerId: string | null;
    activeQuestion: any | null;
    activeQuestionPoints: number;
    eleminationRevealedIndices: number[];
    eleminationEliminatedPlayerIds: string[];
    eleminationRoundResolved: boolean;
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

function waitForNoEvent(socket: ClientSocket, event: string, waitMs = 400): Promise<void> {
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
                    buzzersActive: false,
                    currentBuzzWinnerId: null,
                    activeQuestion: null,
                    activeQuestionPoints: 0,
                    eleminationRevealedIndices: [],
                    eleminationEliminatedPlayerIds: [],
                    eleminationRoundResolved: false,
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
                    score: 0,
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

            socket.on('board_join_session', (roomCode: string) => {
                const session = sessions[roomCode];
                if (!session) return;
                socket.join(roomCode);
                socket.emit('board_connected_success');
            });

            socket.on('host_pick_question', (payload: { catIndex: number; qIndex: number; question: any }) => {
                const hostSession = Object.values(sessions).find((s) => s.hostSocketId === socket.id);
                if (!hostSession) return;

                hostSession.activeCatIndex = payload.catIndex;
                hostSession.activeQIndex = payload.qIndex;
                hostSession.activeQuestion = payload.question;
                hostSession.activeQuestionPoints = payload.question?.points ?? 0;

                if (payload.question?.type === 'elemination') {
                    hostSession.buzzersActive = true;
                    hostSession.currentBuzzWinnerId = null;
                    hostSession.eleminationRevealedIndices = [];
                    hostSession.eleminationEliminatedPlayerIds = [];
                    hostSession.eleminationRoundResolved = false;

                    io.to(hostSession.roomCode).emit('board_show_question', {
                        catIndex: payload.catIndex,
                        qIndex: payload.qIndex,
                        question: payload.question,
                        eleminationRevealedIndices: [],
                    });
                    io.to(hostSession.roomCode).emit('buzzers_unlocked', []);
                }
            });

            socket.on('player_buzz', () => {
                const hostSession = Object.values(sessions).find((s) => !!s.players[socket.id]);
                if (!hostSession) return;

                const player = hostSession.players[socket.id];
                if (!player) return;
                if (!hostSession.buzzersActive) return;
                if (hostSession.eleminationEliminatedPlayerIds.includes(player.id)) return;

                hostSession.buzzersActive = false;
                hostSession.currentBuzzWinnerId = player.id;

                io.to(hostSession.roomCode).emit('player_won_buzz', { id: player.id, name: player.name });
            });

            socket.on('host_reveal_elemination_answer', (index: number) => {
                const hostSession = Object.values(sessions).find((s) => s.hostSocketId === socket.id);
                if (!hostSession) return;

                const q = hostSession.activeQuestion;
                if (!q || q.type !== 'elemination') return;
                if (!Array.isArray(q.listItems)) return;
                if (hostSession.currentBuzzWinnerId === null) return;
                if (index < 0 || index >= q.listItems.length) return;
                if (hostSession.eleminationRevealedIndices.includes(index)) return;

                hostSession.eleminationRevealedIndices.push(index);
                hostSession.currentBuzzWinnerId = null;
                hostSession.buzzersActive = true;

                io.to(hostSession.roomCode).emit('board_reveal_elemination_answer', index);
                io.to(hostSession.roomCode).emit('buzzers_unlocked', hostSession.eleminationEliminatedPlayerIds);

                if (hostSession.eleminationRevealedIndices.length >= q.listItems.length && !hostSession.eleminationRoundResolved) {
                    hostSession.eleminationRoundResolved = true;
                    const remaining = Object.values(hostSession.players).filter(
                        (p) => !hostSession.eleminationEliminatedPlayerIds.includes(p.id)
                    );
                    remaining.forEach((p) => {
                        hostSession.players[p.socketId].score += hostSession.activeQuestionPoints;
                    });

                    io.to(hostSession.roomCode).emit('update_scores', hostSession.players);
                    io.to(hostSession.roomCode).emit('board_hide_question');
                }
            });

            socket.on('host_score_answer', (data: { action: 'correct' | 'incorrect'; playerId: string }) => {
                const hostSession = Object.values(sessions).find((s) => s.hostSocketId === socket.id);
                if (!hostSession) return;
                if (hostSession.activeQuestion?.type !== 'elemination') return;

                if (data.action === 'correct') {
                    io.to(hostSession.roomCode).emit('board_play_sfx', 'correct');

                    const orderedPlayers = Object.values(hostSession.players);
                    const currentIndex = orderedPlayers.findIndex((p) => p.id === hostSession.currentBuzzWinnerId);
                    const candidates = orderedPlayers.filter((p) => !hostSession.eleminationEliminatedPlayerIds.includes(p.id));

                    if (candidates.length > 0) {
                        let next = candidates[0];
                        if (currentIndex >= 0) {
                            for (let step = 1; step <= orderedPlayers.length; step++) {
                                const idx = (currentIndex + step) % orderedPlayers.length;
                                const candidate = orderedPlayers[idx];
                                if (!hostSession.eleminationEliminatedPlayerIds.includes(candidate.id)) {
                                    next = candidate;
                                    break;
                                }
                            }
                        }

                        hostSession.currentBuzzWinnerId = next.id;
                        io.to(hostSession.roomCode).emit('player_won_buzz', { id: next.id, name: next.name });
                    }
                    return;
                }

                if (!hostSession.eleminationEliminatedPlayerIds.includes(data.playerId)) {
                    hostSession.eleminationEliminatedPlayerIds.push(data.playerId);
                }

                hostSession.currentBuzzWinnerId = null;
                const remaining = Object.values(hostSession.players).filter(
                    (p) => !hostSession.eleminationEliminatedPlayerIds.includes(p.id)
                );

                if (remaining.length <= 1 && !hostSession.eleminationRoundResolved) {
                    hostSession.eleminationRoundResolved = true;
                    if (remaining.length === 1) {
                        hostSession.players[remaining[0].socketId].score += hostSession.activeQuestionPoints;
                    }

                    const q = hostSession.activeQuestion;
                    const total = Array.isArray(q?.listItems) ? q.listItems.length : 0;
                    for (let i = 0; i < total; i++) {
                        if (!hostSession.eleminationRevealedIndices.includes(i)) {
                            hostSession.eleminationRevealedIndices.push(i);
                            io.to(hostSession.roomCode).emit('board_reveal_elemination_answer', i);
                        }
                    }

                    io.to(hostSession.roomCode).emit('update_scores', hostSession.players);
                    io.to(hostSession.roomCode).emit('board_hide_question');
                } else {
                    hostSession.buzzersActive = true;
                    io.to(hostSession.roomCode).emit('buzzers_unlocked', hostSession.eleminationEliminatedPlayerIds);
                }
            });

            socket.on('host_set_current_player', (playerId: string) => {
                const hostSession = Object.values(sessions).find((s) => s.hostSocketId === socket.id);
                if (!hostSession) return;

                const target = Object.values(hostSession.players).find((p) => p.id === playerId);
                if (!target) return;

                hostSession.currentBuzzWinnerId = target.id;
                io.to(hostSession.roomCode).emit('player_won_buzz', { id: target.id, name: target.name });
                io.to(hostSession.hostSocketId).emit('update_host_controls', {
                    buzzWinnerId: target.id,
                    buzzWinnerName: target.name,
                    chooserPlayerId: target.id,
                    chooserPlayerName: target.name,
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

    it('should let host set current player and broadcast turn to all clients', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        host.emit('host_create_session', 'game-turn-select');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        playerB.emit('player_join_session', created.roomCode, 'Bob');
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'player_joined');

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

    it('should ignore host_set_current_player for unknown player id', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const player = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(player, 'connect');

        host.emit('host_create_session', 'game-turn-select-invalid');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        player.emit('player_join_session', created.roomCode, 'Alice');
        await waitForEvent<{ playerId: string }>(player, 'player_joined');

        host.emit('host_set_current_player', 'does-not-exist');

        await expect(waitForNoEvent(host, 'player_won_buzz')).resolves.toBeUndefined();
        await expect(waitForNoEvent(board, 'player_won_buzz')).resolves.toBeUndefined();
        await expect(waitForNoEvent(player, 'player_won_buzz')).resolves.toBeUndefined();

        host.disconnect();
        board.disconnect();
        player.disconnect();
    });

    it('should run elemination round: eliminate on wrong, auto-award last player, reveal remaining, close question', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        host.emit('host_create_session', 'game-elemination');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        playerB.emit('player_join_session', created.roomCode, 'Bob');
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'player_joined');

        const question = {
            type: 'elemination',
            points: 100,
            questionText: 'Nenne Obstsorten',
            answerText: 'Apfel, Birne',
            listItems: ['Apfel', 'Birne'],
        };

        const boardShowPromise = waitForEvent<any>(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        const boardShow = await boardShowPromise;
        expect(boardShow.question.type).toBe('elemination');
        expect(boardShow.eleminationRevealedIndices).toEqual([]);

        const wonBuzzPromise = waitForEvent<{ id: string; name: string }>(host, 'player_won_buzz');
        playerA.emit('player_buzz');
        const wonBuzz = await wonBuzzPromise;
        expect(wonBuzz.id).toBe(joinedA.playerId);

        const revealEvents: number[] = [];
        board.on('board_reveal_elemination_answer', (idx: number) => revealEvents.push(idx));

        const scoreUpdatePromise = waitForEvent<any>(host, 'update_scores');
        const hidePromise = waitForEvent(board, 'board_hide_question');

        host.emit('host_score_answer', { action: 'incorrect', playerId: joinedA.playerId });

        const scoreUpdate = await scoreUpdatePromise;
        await hidePromise;

        const scoresById = Object.values(scoreUpdate).reduce((acc: Record<string, number>, p: any) => {
            acc[p.id] = p.score;
            return acc;
        }, {});

        expect(scoresById[joinedA.playerId]).toBe(0);
        expect(scoresById[joinedB.playerId]).toBe(100);
        expect(revealEvents.sort((a, b) => a - b)).toEqual([0, 1]);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should allow correct in elemination and still reveal answers individually', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');

        host.emit('host_create_session', 'game-elemination-correct-reveal');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        const question = {
            type: 'elemination',
            points: 100,
            questionText: 'Nenne Tiere',
            answerText: 'Hund, Katze',
            listItems: ['Hund', 'Katze'],
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await waitForEvent<any>(board, 'board_show_question');

        const turn = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerA.emit('player_buzz');
        expect((await turn).id).toBe(joinedA.playerId);

        const sfxPromise = waitForEvent<'correct' | 'incorrect'>(board, 'board_play_sfx');
        host.emit('host_score_answer', { action: 'correct', playerId: joinedA.playerId });
        await expect(sfxPromise).resolves.toBe('correct');

        const revealPromise = waitForEvent<number>(board, 'board_reveal_elemination_answer');
        host.emit('host_reveal_elemination_answer', 0);
        await expect(revealPromise).resolves.toBe(0);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
    });

    it('should set next player active after elemination correct scoring', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');

        host.emit('host_create_session', 'game-elemination-correct-next');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        playerB.emit('player_join_session', created.roomCode, 'Bob');
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'player_joined');

        const question = {
            type: 'elemination',
            points: 120,
            questionText: 'Nenne Browser',
            answerText: 'Chrome, Firefox',
            listItems: ['Chrome', 'Firefox'],
        };

        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });

        const turnA = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerA.emit('player_buzz');
        expect((await turnA).id).toBe(joinedA.playerId);

        const nextTurn = waitForEvent<{ id: string; name: string }>(host, 'player_won_buzz');
        host.emit('host_score_answer', { action: 'correct', playerId: joinedA.playerId });

        await expect(nextTurn).resolves.toEqual({ id: joinedB.playerId, name: 'Bob' });

        host.disconnect();
        playerA.disconnect();
        playerB.disconnect();
    });

    it('should award points to all remaining players when all elemination answers are revealed', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });
        const playerC = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');
        await waitForEvent(playerC, 'connect');

        host.emit('host_create_session', 'game-elemination-reveal-all');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        playerB.emit('player_join_session', created.roomCode, 'Bob');
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'player_joined');

        playerC.emit('player_join_session', created.roomCode, 'Cara');
        const joinedC = await waitForEvent<{ playerId: string }>(playerC, 'player_joined');

        const question = {
            type: 'elemination',
            points: 50,
            questionText: 'Nenne Farben',
            answerText: 'Rot, Blau',
            listItems: ['Rot', 'Blau'],
        };

        const boardShowPromise = waitForEvent<any>(board, 'board_show_question');
        host.emit('host_pick_question', { catIndex: 0, qIndex: 0, question });
        await boardShowPromise;

        const revealEvents: number[] = [];
        board.on('board_reveal_elemination_answer', (idx: number) => revealEvents.push(idx));

        const wonBuzzA = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerA.emit('player_buzz');
        expect((await wonBuzzA).id).toBe(joinedA.playerId);
        host.emit('host_reveal_elemination_answer', 0);

        const wonBuzzB = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerB.emit('player_buzz');
        expect((await wonBuzzB).id).toBe(joinedB.playerId);

        const scoreUpdatePromise = waitForEvent<any>(host, 'update_scores');
        const hidePromise = waitForEvent(board, 'board_hide_question');
        host.emit('host_reveal_elemination_answer', 1);

        const scoreUpdate = await scoreUpdatePromise;
        await hidePromise;

        const scoresById = Object.values(scoreUpdate).reduce((acc: Record<string, number>, p: any) => {
            acc[p.id] = p.score;
            return acc;
        }, {});

        expect(scoresById[joinedA.playerId]).toBe(50);
        expect(scoresById[joinedB.playerId]).toBe(50);
        expect(scoresById[joinedC.playerId]).toBe(50);
        expect(revealEvents.sort((a, b) => a - b)).toEqual([0, 1]);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
        playerC.disconnect();
    });

    it('should award points only to remaining players when one player was eliminated before full elemination reveal', async () => {
        const host = ioClient(baseUrl, { transports: ['websocket'] });
        const board = ioClient(baseUrl, { transports: ['websocket'] });
        const playerA = ioClient(baseUrl, { transports: ['websocket'] });
        const playerB = ioClient(baseUrl, { transports: ['websocket'] });
        const playerC = ioClient(baseUrl, { transports: ['websocket'] });

        await waitForEvent(host, 'connect');
        await waitForEvent(board, 'connect');
        await waitForEvent(playerA, 'connect');
        await waitForEvent(playerB, 'connect');
        await waitForEvent(playerC, 'connect');

        host.emit('host_create_session', 'game-elemination-remaining');
        const created = await waitForEvent<{ roomCode: string }>(host, 'session_created');

        board.emit('board_join_session', created.roomCode);
        await waitForEvent(board, 'board_connected_success');

        playerA.emit('player_join_session', created.roomCode, 'Alice');
        const joinedA = await waitForEvent<{ playerId: string }>(playerA, 'player_joined');

        playerB.emit('player_join_session', created.roomCode, 'Bob');
        const joinedB = await waitForEvent<{ playerId: string }>(playerB, 'player_joined');

        playerC.emit('player_join_session', created.roomCode, 'Cara');
        const joinedC = await waitForEvent<{ playerId: string }>(playerC, 'player_joined');

        const question = {
            type: 'elemination',
            points: 70,
            questionText: 'Nenne Tiere',
            answerText: 'Hund, Katze',
            listItems: ['Hund', 'Katze'],
        };

        host.emit('host_pick_question', { catIndex: 1, qIndex: 1, question });
        await waitForEvent<any>(board, 'board_show_question');

        const revealEvents: number[] = [];
        board.on('board_reveal_elemination_answer', (idx: number) => revealEvents.push(idx));

        // Spieler A buzzert und wird eliminiert.
        const wonBuzzA = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerA.emit('player_buzz');
        expect((await wonBuzzA).id).toBe(joinedA.playerId);
        host.emit('host_score_answer', { action: 'incorrect', playerId: joinedA.playerId });

        // Spieler B buzzert und deckt Antwort 0 auf.
        const wonBuzzB = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerB.emit('player_buzz');
        expect((await wonBuzzB).id).toBe(joinedB.playerId);
        host.emit('host_reveal_elemination_answer', 0);

        // Spieler C buzzert und deckt letzte Antwort auf -> Punkte nur fuer B und C.
        const wonBuzzC = waitForEvent<{ id: string }>(host, 'player_won_buzz');
        playerC.emit('player_buzz');
        expect((await wonBuzzC).id).toBe(joinedC.playerId);

        const scoreUpdatePromise = waitForEvent<any>(host, 'update_scores');
        const hidePromise = waitForEvent(board, 'board_hide_question');
        host.emit('host_reveal_elemination_answer', 1);

        const scoreUpdate = await scoreUpdatePromise;
        await hidePromise;

        const scoresById = Object.values(scoreUpdate).reduce((acc: Record<string, number>, p: any) => {
            acc[p.id] = p.score;
            return acc;
        }, {});

        expect(scoresById[joinedA.playerId]).toBe(0);
        expect(scoresById[joinedB.playerId]).toBe(70);
        expect(scoresById[joinedC.playerId]).toBe(70);
        expect(revealEvents.sort((a, b) => a - b)).toEqual([0, 1]);

        host.disconnect();
        board.disconnect();
        playerA.disconnect();
        playerB.disconnect();
        playerC.disconnect();
    });
});
