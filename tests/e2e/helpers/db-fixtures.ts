import type { ICategory, IGame, IQuestion, QuestionType } from '../../../src/types';

export type FixtureName =
    | 'quizSmallAllTypes5x5'
    | 'quizLarge10x10'
    | 'quizTall1x15'
    | 'quizWide15x1'
    | 'quizWithMedia3x3'
    | 'quizMinimal1x1';

const IMG_URL = 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1400&q=80&auto=format&fit=crop';
const AUDIO_URL = 'https://samplelib.com/lib/preview/mp3/sample-12s.mp3';
const VIDEO_URL = 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4';

function baseQuestion(overrides: Partial<IQuestion> = {}): IQuestion {
    return {
        type: 'standard',
        points: 100,
        negativePoints: 50,
        questionText: 'Default question',
        answerText: 'Default answer',
        mediaPath: '',
        hasMedia: false,
        mediaType: 'none',
        answerMediaPath: '',
        hasAnswerMedia: false,
        answerMediaType: 'none',
        ...overrides,
    };
}

function typedQuestion(type: QuestionType, index: number): IQuestion {
    switch (type) {
        case 'map':
            return baseQuestion({
                type,
                questionText: `Map question ${index + 1}`,
                answerText: 'Berlin',
                location: {
                    lat: 52.52,
                    lng: 13.405,
                    isCustomMap: false,
                    customMapPath: '',
                    mapWidth: 1000,
                    mapHeight: 1000,
                    radius: 2000,
                },
            });
        case 'estimate':
            return baseQuestion({
                type,
                questionText: `Estimate question ${index + 1}`,
                answerText: '206',
                estimationAnswer: 206,
            });
        case 'list':
            return baseQuestion({
                type,
                questionText: `List question ${index + 1}`,
                answerText: 'TypeScript, Python, Go',
                listItems: ['TypeScript', 'Python', 'Go'],
            });
        case 'pixel':
            return baseQuestion({
                type,
                questionText: `Pixel question ${index + 1}`,
                answerText: 'Paris',
                mediaPath: IMG_URL,
                hasMedia: true,
                mediaType: 'image',
                pixelConfig: {
                    resolutionDuration: 10,
                    effectType: 'pixelate',
                },
            });
        case 'freetext':
            return baseQuestion({
                type,
                questionText: `Freetext question ${index + 1}`,
                answerText: 'Communication',
            });
        case 'elemination':
            return baseQuestion({
                type,
                questionText: `Elimination question ${index + 1}`,
                answerText: 'Alderaan',
                listItems: ['Merkur', 'Venus', 'Mars', 'Alderaan', 'Jupiter'],
            });
        default:
            return baseQuestion({
                type: 'standard',
                questionText: `Standard question ${index + 1}`,
                answerText: `Answer ${index + 1}`,
            });
    }
}

function buildGridGame(title: string, categoriesCount: number, questionsCount: number): IGame {
    const categories: ICategory[] = [];
    for (let c = 0; c < categoriesCount; c++) {
        const questions: IQuestion[] = [];
        for (let q = 0; q < questionsCount; q++) {
            questions.push(
                baseQuestion({
                    type: 'standard',
                    points: (q + 1) * 100,
                    negativePoints: Math.floor((q + 1) * 50),
                    questionText: `${title} C${c + 1} Q${q + 1}`,
                    answerText: `A${c + 1}-${q + 1}`,
                })
            );
        }
        categories.push({ name: `Category ${c + 1}`, questions });
    }

    return {
        title,
        categories,
        boardBackgroundPath: '',
        backgroundMusicPath: '',
        soundCorrectPath: '',
        soundIncorrectPath: '',
    };
}

function buildAllTypes5x5(): IGame {
    const orderedTypes: QuestionType[] = [
        'standard',
        'map',
        'estimate',
        'list',
        'pixel',
        'freetext',
        'elemination',
    ];

    const categories: ICategory[] = [];
    let idx = 0;

    for (let c = 0; c < 5; c++) {
        const questions: IQuestion[] = [];
        for (let q = 0; q < 5; q++) {
            const type = orderedTypes[idx % orderedTypes.length];
            const question = typedQuestion(type, idx);
            question.points = (q + 1) * 100;
            question.negativePoints = Math.floor(question.points / 2);
            questions.push(question);
            idx += 1;
        }
        categories.push({ name: `Type Category ${c + 1}`, questions });
    }

    return {
        title: 'E2E All Types 5x5',
        boardBackgroundPath: IMG_URL,
        backgroundMusicPath: AUDIO_URL,
        soundCorrectPath: AUDIO_URL,
        soundIncorrectPath: AUDIO_URL,
        categories,
    };
}

function buildMedia3x3(): IGame {
    const cat1: ICategory = {
        name: 'Media Icons',
        questions: [
            baseQuestion({
                type: 'standard',
                points: 100,
                negativePoints: 50,
                questionText: 'Image media question',
                answerText: 'Fox',
                mediaPath: IMG_URL,
                hasMedia: true,
                mediaType: 'image',
            }),
            baseQuestion({
                type: 'standard',
                points: 200,
                negativePoints: 100,
                questionText: 'Audio media question',
                answerText: 'Piano',
                mediaPath: AUDIO_URL,
                hasMedia: true,
                mediaType: 'audio',
            }),
            baseQuestion({
                type: 'standard',
                points: 300,
                negativePoints: 150,
                questionText: 'Video media question',
                answerText: 'Ocean waves',
                mediaPath: VIDEO_URL,
                hasMedia: true,
                mediaType: 'video',
            }),
        ],
    };

    const cat2: ICategory = {
        name: 'Answer Media',
        questions: [
            baseQuestion({
                type: 'standard',
                points: 100,
                negativePoints: 50,
                questionText: 'Answer image media',
                answerText: 'Image answer',
                answerMediaPath: IMG_URL,
                hasAnswerMedia: true,
                answerMediaType: 'image',
            }),
            baseQuestion({
                type: 'standard',
                points: 200,
                negativePoints: 100,
                questionText: 'Answer audio media',
                answerText: 'Audio answer',
                answerMediaPath: AUDIO_URL,
                hasAnswerMedia: true,
                answerMediaType: 'audio',
            }),
            baseQuestion({
                type: 'standard',
                points: 300,
                negativePoints: 150,
                questionText: 'Answer video media',
                answerText: 'Video answer',
                answerMediaPath: VIDEO_URL,
                hasAnswerMedia: true,
                answerMediaType: 'video',
            }),
        ],
    };

    const cat3: ICategory = {
        name: 'Mixed',
        questions: [
            baseQuestion({
                type: 'standard',
                points: 100,
                negativePoints: 50,
                questionText: 'Both media set',
                answerText: 'Both set',
                mediaPath: IMG_URL,
                hasMedia: true,
                mediaType: 'image',
                answerMediaPath: VIDEO_URL,
                hasAnswerMedia: true,
                answerMediaType: 'video',
            }),
            baseQuestion({
                type: 'standard',
                points: 200,
                negativePoints: 100,
                questionText: 'No media',
                answerText: 'None',
            }),
            typedQuestion('freetext', 999),
        ],
    };

    return {
        title: 'E2E Media Icons 3x3',
        categories: [cat1, cat2, cat3],
        boardBackgroundPath: '',
        backgroundMusicPath: '',
        soundCorrectPath: '',
        soundIncorrectPath: '',
    };
}

export function buildFixtures(): Record<FixtureName, IGame> {
    return {
        quizSmallAllTypes5x5: buildAllTypes5x5(),
        quizLarge10x10: buildGridGame('E2E Grid 10x10', 10, 10),
        quizTall1x15: buildGridGame('E2E Grid 1x15', 1, 15),
        quizWide15x1: buildGridGame('E2E Grid 15x1', 15, 1),
        quizWithMedia3x3: buildMedia3x3(),
        quizMinimal1x1: buildGridGame('E2E Minimal 1x1', 1, 1),
    };
}
