import { IGame, ICategory, IQuestion, IPlayer, ISession } from '../../src/types';

// ========== MOCK QUESTIONS ==========

export const mockStandardQuestion: IQuestion = {
    type: 'standard',
    points: 100,
    negativePoints: 0,
    questionText: 'Welche Stadt ist die Hauptstadt von Frankreich?',
    answerText: 'Paris',
    mediaPath: '',
    hasMedia: false,
    mediaType: 'none',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

export const mockMapQuestion: IQuestion = {
    type: 'map',
    points: 200,
    negativePoints: -50,
    questionText: 'Wo liegt Berlin?',
    answerText: 'Mitteldeutschland',
    location: {
        lat: 52.52,
        lng: 13.405,
        isCustomMap: false,
        customMapPath: '',
        mapWidth: 800,
        mapHeight: 600,
        radius: 100000,
    },
    mediaPath: '',
    hasMedia: false,
    mediaType: 'none',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

export const mockEstimateQuestion: IQuestion = {
    type: 'estimate',
    points: 300,
    negativePoints: 0,
    questionText: 'Wie viele Menschen leben auf der Erde?',
    answerText: '~8 Milliarden',
    estimationAnswer: 8000000000,
    mediaPath: '',
    hasMedia: false,
    mediaType: 'none',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

export const mockListQuestion: IQuestion = {
    type: 'list',
    points: 250,
    negativePoints: 0,
    questionText: 'Nenne die Länder der Benelux-Union:',
    answerText: 'Belgien, Niederlande, Luxemburg',
    listItems: ['Belgien', 'Niederlande', 'Luxemburg'],
    mediaPath: '',
    hasMedia: false,
    mediaType: 'none',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

export const mockPixelQuestion: IQuestion = {
    type: 'pixel',
    points: 400,
    negativePoints: 0,
    questionText: 'Was ist das?',
    answerText: 'Das Brandenburger Tor',
    pixelConfig: {
        blurStrength: 5,
        resolutionDuration: 15,
        effectType: 'pixelate',
    },
    mediaPath: '/uploads/brandenburger-tor.jpg',
    hasMedia: true,
    mediaType: 'image',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

export const mockFreetextQuestion: IQuestion = {
    type: 'freetext',
    points: 150,
    negativePoints: 0,
    questionText: 'Wie heißt der längste Fluss Europas?',
    answerText: 'Wolga',
    mediaPath: '',
    hasMedia: false,
    mediaType: 'none',
    answerMediaPath: '',
    hasAnswerMedia: false,
    answerMediaType: 'none',
};

// ========== MOCK CATEGORIES & GAMES ==========

export const mockCategory: ICategory = {
    name: 'Geographie',
    questions: [mockStandardQuestion, mockMapQuestion, mockListQuestion],
};

export const mockCategoryWithImages: ICategory = {
    name: 'Bilderrätsel',
    questions: [mockPixelQuestion],
};

export const mockCategoryFreetext: ICategory = {
    name: 'Freitext',
    questions: [mockFreetextQuestion],
};

export const mockGame: IGame = {
    title: 'Test Quiz',
    categories: [mockCategory, mockCategoryFreetext],
    boardBackgroundPath: '',
    backgroundMusicPath: '',
    soundCorrectPath: '',
    soundIncorrectPath: '',
};

export const mockGameWithImages: IGame = {
    title: 'Image Quiz',
    categories: [mockCategoryWithImages],
    boardBackgroundPath: '',
    backgroundMusicPath: '',
    soundCorrectPath: '',
    soundIncorrectPath: '',
};

// ========== MOCK PLAYERS ==========

export const mockPlayer1: IPlayer = {
    id: 'player-1',
    name: 'Alice',
    score: 100,
    socketId: 'socket-1',
    color: '#FF5733',
    active: true,
};

export const mockPlayer2: IPlayer = {
    id: 'player-2',
    name: 'Bob',
    score: 200,
    socketId: 'socket-2',
    color: '#33FF57',
    active: true,
};

export const mockPlayer3: IPlayer = {
    id: 'player-3',
    name: 'Charlie',
    score: 150,
    socketId: 'socket-3',
    color: '#3357FF',
    active: true,
};

// ========== MOCK SESSION ==========

export const mockSession: ISession = {
    gameId: 'game-123',
    game: mockGame,
    hostSocketId: 'host-socket',
    boardSocketId: 'board-socket',
    players: {
        'player-1': mockPlayer1,
        'player-2': mockPlayer2,
    },
    playerOrder: ['player-1', 'player-2'],
    currentTurnPlayerId: 'player-1',
    lastEleminationRevealerId: null,
    buzzersActive: true,
    currentBuzzWinnerId: null,
    activeQuestion: null,
    activeQuestionPoints: 100,
    mapGuesses: {},
    estimateGuesses: {},
    usedQuestions: [],
    introIndex: 0,
    listRevealedCount: 0,
    eleminationRevealedIndices: [],
    eleminationEliminatedPlayerIds: [],
    eleminationRoundResolved: false,
    freetextAnswers: {},
    lockedPlayers: [],
};
