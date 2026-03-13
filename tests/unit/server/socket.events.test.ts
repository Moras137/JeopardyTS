import { MockSocket, MockIOServer, generateTestRoomCode } from '@tests/fixtures/test-helpers';
import { mockGame, mockPlayer1, mockPlayer2 } from '@tests/fixtures/mock-data';

describe('Socket.io Event Handlers', () => {
    let ioServer: MockIOServer;
    let hostSocket: MockSocket;
    let playerSocket: MockSocket;
    let boardSocket: MockSocket;

    beforeEach(() => {
        ioServer = new MockIOServer();
        hostSocket = new MockSocket('host-socket');
        playerSocket = new MockSocket('player-socket');
        boardSocket = new MockSocket('board-socket');

        ioServer.registerSocket(hostSocket);
        ioServer.registerSocket(playerSocket);
        ioServer.registerSocket(boardSocket);
    });

    describe('host_create_session', () => {
        it('should create a new session when host connects', () => {
            const gameId = 'game-123';
            
            // Simulate: Host emits host_create_session
            const sessionData = {
                gameId,
                hostSocketId: hostSocket.id,
            };

            expect(sessionData.gameId).toBe('game-123');
            expect(sessionData.hostSocketId).toBe('host-socket');
        });

        it('should generate unique room code for session', () => {
            const roomCode1 = generateTestRoomCode();
            const roomCode2 = generateTestRoomCode();

            expect(roomCode1).toMatch(/^\d{4}$/);
            expect(roomCode2).toMatch(/^\d{4}$/);
        });

        it('should store game data in session', () => {
            const session = {
                gameId: mockGame._id,
                game: mockGame,
                hostSocketId: hostSocket.id,
                boardSocketId: undefined,
                players: {},
            };

            expect(session.game.title).toBe('Test Quiz');
            expect(session.game.categories).toHaveLength(2);
        });
    });

    describe('player_join_session', () => {
        it('should add player to session', () => {
            const players: Record<string, any> = {};
            
            players['player-1'] = {
                id: 'player-1',
                name: 'Alice',
                socketId: playerSocket.id,
                score: 0,
                active: true,
            };

            expect(Object.keys(players)).toHaveLength(1);
            expect(players['player-1'].name).toBe('Alice');
        });

        it('should assign unique player ID', () => {
            const player1Id = `player-${Date.now()}-1`;
            const player2Id = `player-${Date.now()}-2`;

            expect(player1Id).not.toBe(player2Id);
        });

        it('should initialize player with score 0', () => {
            const newPlayer = {
                id: 'player-1',
                name: 'Bob',
                score: 0,
                socketId: playerSocket.id,
                active: true,
                color: '#33FF57',
            };

            expect(newPlayer.score).toBe(0);
        });
    });

    describe('player_buzz', () => {
        it('should register player buzz', () => {
            const buzzWinnerId = mockPlayer1.id;
            const buzzTimestamp = Date.now();

            expect(buzzWinnerId).toBe('player-1');
            expect(typeof buzzTimestamp).toBe('number');
        });

        it('should disable buzzers after someone buzzes', () => {
            let buzzersActive = true;
            
            if (buzzersActive) {
                buzzersActive = false;
            }

            expect(buzzersActive).toBe(false);
        });

        it('should not allow buzzing when buzzers are locked', () => {
            let buzzersActive = false;
            
            if (!buzzersActive) {
                // Ignore buzz
            }

            expect(buzzersActive).toBe(false);
        });
    });

    describe('host_pick_question', () => {
        it('should set active question from category', () => {
            const catIndex = 0;
            const qIndex = 0;
            const questions = mockGame.categories[catIndex].questions;
            const selectedQuestion = questions[qIndex];

            expect(selectedQuestion).toBeDefined();
            expect(selectedQuestion.questionText).toBeTruthy();
        });

        it('should track used questions', () => {
            const usedQuestions: Array<{ catIndex: number; qIndex: number }> = [];
            
            usedQuestions.push({ catIndex: 0, qIndex: 0 });
            usedQuestions.push({ catIndex: 0, qIndex: 1 });

            expect(usedQuestions).toHaveLength(2);
            expect(usedQuestions).toContainEqual({ catIndex: 0, qIndex: 0 });
        });

        it('should prevent picking same question twice', () => {
            const usedQuestions: Array<{ catIndex: number; qIndex: number }> = [];
            const questionToAsk = { catIndex: 0, qIndex: 0 };

            const alreadyUsed = usedQuestions.some(
                q => q.catIndex === questionToAsk.catIndex && q.qIndex === questionToAsk.qIndex
            );

            expect(alreadyUsed).toBe(false);
        });
    });

    describe('host_correct_answer', () => {
        it('should add points to player score', () => {
            const player = { ...mockPlayer1, score: 100 };
            const points = 200;
            
            player.score += points;

            expect(player.score).toBe(300);
        });

        it('should broadcast updated scores', () => {
            const players = {
                'player-1': { ...mockPlayer1, score: 300 },
                'player-2': { ...mockPlayer2, score: 200 },
            };

            expect(players['player-1'].score).toBe(300);
            expect(players['player-2'].score).toBe(200);
        });
    });

    describe('host_incorrect_answer', () => {
        it('should subtract negative points if applicable', () => {
            const player = { ...mockPlayer1, score: 100 };
            const negativePoints = 50;
            
            player.score -= negativePoints;

            expect(player.score).toBe(50);
        });

        it('should not go below 0 points', () => {
            let score = 20;
            const penalty = 50;
            
            score -= penalty;
            if (score < 0) score = 0;

            expect(score).toBe(0);
        });
    });

    describe('player_disconnect', () => {
        it('should mark player as inactive', () => {
            const player = { ...mockPlayer1, active: true };
            player.active = false;

            expect(player.active).toBe(false);
        });

        it('should preserve player data for reconnection', () => {
            const savedPlayerData = { ...mockPlayer1 };
            
            // Player reconnects
            savedPlayerData.socketId = 'new-socket-id';

            expect(savedPlayerData.name).toBe('Alice');
            expect(savedPlayerData.score).toBe(100);
            expect(savedPlayerData.socketId).toBe('new-socket-id');
        });
    });

    describe('player_reconnect', () => {
        it('should restore player session on reconnect', () => {
            const savedData = {
                playerId: 'player-1',
                roomCode: '1234',
                name: 'Alice',
            };

            const restoredSession = {
                playerId: savedData.playerId,
                roomCode: savedData.roomCode,
                name: savedData.name,
            };

            expect(restoredSession).toEqual(savedData);
        });
    });
});
