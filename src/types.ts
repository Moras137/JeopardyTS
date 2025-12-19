export type QuestionType = 'standard' | 'map' | 'estimate' | 'list' | 'pixel' | 'freetext';
export type MediaType = 'none' | 'image' | 'video' | 'audio';

export interface ILocation {
    lat: number;
    lng: number;
    isCustomMap: boolean;
    customMapPath: string;
    mapWidth: number;
    mapHeight: number;
}

export interface IQuestion {
    type: QuestionType;
    location?: ILocation;
    points: number;
    negativePoints: number;
    questionText: string;
    answerText: string;
    
    estimationAnswer?: number;  // Für Schätzfragen
    listItems?: string[];    // Für Listen-Fragen
    pixelConfig?: {             
        blurStrength?: number;      // (Legacy/Optional)
        resolutionDuration?: number;// Dauer in Sekunden bis zur vollständigen Auflösung
        effectType?: 'pixelate' | 'twist' | 'shuffle';
    };

    answerMediaPath: string;
    hasAnswerMedia: boolean;
    answerMediaType: MediaType;

    mediaPath: string;
    hasMedia: boolean;
    mediaType: MediaType;
}

export interface ICategory {
    name: string;
    questions: IQuestion[];
}

export interface IGame {
    _id?: string; // Optional, da es vor dem Speichern noch keine ID hat
    title: string;
    boardBackgroundPath?: string;
    backgroundMusicPath?: string;
    soundCorrectPath?: string;
    soundIncorrectPath?: string;
    categories: ICategory[];
}

// --- SPIELZUSTAND ---

export interface IPlayer {
    id: string;
    name: string;
    score: number;
    socketId: string;
    color: string;
    active: boolean;
}

export interface ISession {
    gameId: string;
    game: IGame;
    hostSocketId: string;
    boardSocketId?: string;
    players: Record<string, IPlayer>;
    buzzersActive: boolean;
    currentBuzzWinnerId: string | null;
    activeQuestion: IQuestion | null;
    activeQuestionPoints: number;
    mapGuesses: Record<string, { lat: number; lng: number }>;
    estimateGuesses: Record<string, number>; 
    usedQuestions: { catIndex: number, qIndex: number }[];
    introIndex: number;
    listRevealedCount: number;
    freetextAnswers: Record<string, string>;
}

// --- SOCKET EVENTS ---
// Hier definieren wir exakt, was gesendet/empfangen wird

export interface ServerToClientEvents {
    session_created: (roomCode: string) => void;
    session_rejoined: (data: { roomCode: string, gameId: string }) => void;
    host_session_restored: (data: {roomCode: string; game: IGame; players: Record<string, IPlayer>; activeQuestion: IQuestion | null; usedQuestions: { catIndex: number, qIndex: number }[];}) => void;
    host_rejoin_error: () => void;
    error_message: (message: string) => void;
    board_connected_success: () => void;
    board_init_game: (game: IGame) => void;
    update_scores: (players: Record<string, IPlayer>) => void;
    update_player_list: (players: Record<string, IPlayer>) => void;
    update_host_controls: (data: any) => void; // Kann man noch feiner typisieren
    host_update_map_status: (data: { submittedCount: number, totalPlayers: number }) => void;
    player_won_buzz: (data: { id: string, name: string }) => void;
    buzzers_locked: () => void;
    buzzers_unlocked: () => void;
    join_success: (data: { playerId: string, roomCode: string, name: string }) => void;
    join_error: (msg: string) => void;
    player_start_map_guess: (data: { questionText: string, location?: ILocation, points: number }) => void;
    player_new_question: (data: { text: string, points: number }) => void;
    board_show_question: (data: { catIndex: number, qIndex: number, question: IQuestion, currentListIndex?: number }) => void;
    board_reveal_answer: () => void;
    board_hide_question: () => void;
    board_toggle_qr: () => void;
    board_reveal_map_results: (data: any) => void;
    board_reveal_list_item: (index: number) => void;
    session_ended: () => void;
    load_game_on_host: (game: IGame) => void;
    host_restore_active_question: (data: { question: IQuestion, catIndex: number, qIndex: number, buzzersActive: boolean,mapGuessesCount: number }) => void;
    music_control: (data: { action: 'play' | 'pause' | 'volume', value?: number }) => void;
    server_network_info: (data: { ip: string, port: number }) => void;
    load_game_on_board: (data: { game: IGame, usedQuestions: { catIndex: number, qIndex: number }[] }) => void;
    board_show_intro: (data: { text: string, subtext?: string, type: 'title' | 'category' | 'end' }) => void;
    board_control_pixel_puzzle: (action: 'pause' | 'resume') => void;
    player_start_estimate: (data: { text: string, points: number }) => void;
    host_update_estimate_status: (data: { submittedCount: number, totalPlayers: number }) => void;
    board_reveal_estimate_results: (data: { correctAnswer: number, guesses: { playerId: string, name: string, value: number, diff: number, isWinner: boolean }[] }) => void;
    board_play_sfx: (type: 'correct' | 'incorrect') => void;
    player_start_freetext: (data: { text: string, points: number }) => void;
    board_show_freetext_results: (data: { answers: { playerId: string, name: string, text: string }[] }) => void;
    board_freetext_mark_correct: (playerId: string) => void; 
}

export interface ClientToServerEvents {
    host_create_session: (gameId: string) => void;
    host_rejoin_session: (roomCode: string) => void;
    board_join_session: (roomCode: string) => void;
    player_join_session: (data: { roomCode: string, name: string, existingPlayerId?: string }) => void;
    player_buzz: (data: { id: string, name: string }) => void;
    host_score_answer: (data: { action: 'correct' | 'incorrect', playerId: string }) => void;
    host_toggle_qr: () => void;
    host_unlock_buzzers: () => void;
    host_close_question: () => void;
    host_pick_question: (data: { catIndex: number, qIndex: number, question: IQuestion }) => void;
    player_submit_map_guess: (coords: { lat: number, lng: number }) => void;
    host_resolve_map: () => void;
    host_end_session: () => void;
    host_start_game: (gameId: string) => void;
    music_control: (data: { gameId: string, action: 'play' | 'pause' | 'volume', value?: number }) => void;
    host_next_intro: () => void;
    host_reveal_next_list_item: () => void;
    host_control_pixel_puzzle: (action: 'pause' | 'resume') => void;
    player_submit_estimate: (value: number) => void;
    host_resolve_estimate: () => void;
    player_submit_freetext: (text: string) => void;
    host_resolve_freetext: () => void;
}