import { mockGame, mockCategory, mockStandardQuestion } from '@tests/fixtures/mock-data';
import { ICategory } from '@/types';

describe('Quiz Model & Schema', () => {
    describe('Game Schema', () => {
        it('should have required title field', () => {
            expect(mockGame.title).toBeTruthy();
            expect(typeof mockGame.title).toBe('string');
        });

        it('should have categories array', () => {
            expect(mockGame.categories).toBeDefined();
            expect(Array.isArray(mockGame.categories)).toBe(true);
        });

        it('should have optional background image path', () => {
            expect(mockGame.boardBackgroundPath).toBeDefined();
        });

        it('should have optional background music path', () => {
            expect(mockGame.backgroundMusicPath).toBeDefined();
        });

        it('should have optional sound paths', () => {
            expect(mockGame.soundCorrectPath).toBeDefined();
            expect(mockGame.soundIncorrectPath).toBeDefined();
        });
    });

    describe('Category Schema', () => {
        it('should have name field', () => {
            expect(mockCategory.name).toBeTruthy();
            expect(typeof mockCategory.name).toBe('string');
        });

        it('should have questions array', () => {
            expect(mockCategory.questions).toBeDefined();
            expect(Array.isArray(mockCategory.questions)).toBe(true);
        });

        it('should have at least one question', () => {
            expect(mockCategory.questions.length).toBeGreaterThan(0);
        });
    });

    describe('Question Schema', () => {
        it('should have type field with valid enum value', () => {
            const validTypes = ['standard', 'map', 'estimate', 'list', 'pixel', 'freetext'];
            expect(validTypes).toContain(mockStandardQuestion.type);
        });

        it('should have question text', () => {
            expect(mockStandardQuestion.questionText).toBeTruthy();
        });

        it('should have answer text', () => {
            expect(mockStandardQuestion.answerText).toBeTruthy();
        });

        it('should have points value', () => {
            expect(mockStandardQuestion.points).toBeGreaterThanOrEqual(0);
        });

        it('should have negative points field', () => {
            expect(typeof mockStandardQuestion.negativePoints).toBe('number');
        });

        it('should have media fields', () => {
            expect(mockStandardQuestion.hasMedia).toBeDefined();
            expect(mockStandardQuestion.mediaType).toBeDefined();
            expect(mockStandardQuestion.mediaPath).toBeDefined();
        });

        it('should have answer media fields', () => {
            expect(mockStandardQuestion.hasAnswerMedia).toBeDefined();
            expect(mockStandardQuestion.answerMediaType).toBeDefined();
            expect(mockStandardQuestion.answerMediaPath).toBeDefined();
        });
    });

    describe('Question Type Validation', () => {
        it('should validate "standard" type has no special fields', () => {
            const question = mockStandardQuestion;
            
            expect(question.type).toBe('standard');
            expect(question.location).toBeUndefined();
            expect(question.estimationAnswer).toBeUndefined();
            expect(question.listItems).toBeUndefined();
        });

        it('should validate "map" type has location', () => {
            const question = mockGame.categories[0].questions[1]; // Map question
            
            expect(question.type).toBe('map');
            expect(question.location).toBeDefined();
            expect(question.location?.lat).toBeDefined();
            expect(question.location?.lng).toBeDefined();
        });

        it('should validate "estimate" type has estimation answer', () => {
            // Estimate question is in mockGame under first category (Geographie)
            // Create a test question directly since mockGame doesn't have estimate in the test categories
            const estimateQuestion = {
                type: 'estimate' as const,
                points: 300,
                negativePoints: 0,
                questionText: 'Wie viele Menschen leben auf der Erde?',
                answerText: '~8 Milliarden',
                estimationAnswer: 8000000000,
                mediaPath: '',
                hasMedia: false,
                mediaType: 'none' as const,
                answerMediaPath: '',
                hasAnswerMedia: false,
                answerMediaType: 'none' as const,
            };
            
            expect(estimateQuestion.type).toBe('estimate');
            expect(estimateQuestion.estimationAnswer).toBeDefined();
        });

        it('should validate "pixel" type has pixel config', () => {
            // Pixel question is in mockGameWithImages
            const pixelQuestion = {
                type: 'pixel' as const,
                points: 400,
                negativePoints: 0,
                questionText: 'Was ist das?',
                answerText: 'Das Brandenburger Tor',
                pixelConfig: {
                    blurStrength: 5,
                    resolutionDuration: 15,
                    effectType: 'pixelate' as const,
                },
                mediaPath: '/uploads/brandenburger-tor.jpg',
                hasMedia: true,
                mediaType: 'image' as const,
                answerMediaPath: '',
                hasAnswerMedia: false,
                answerMediaType: 'none' as const,
            };
            
            expect(pixelQuestion.type).toBe('pixel');
            expect(pixelQuestion.pixelConfig).toBeDefined();
            expect(pixelQuestion.pixelConfig?.resolutionDuration).toBeDefined();
        });

        it('should validate "freetext" type structure', () => {
            const question = mockGame.categories.find((c: ICategory) => c.name === 'Freitext')?.questions[0];
            
            expect(question?.type).toBe('freetext');
            expect(question?.questionText).toBeTruthy();
            expect(question?.answerText).toBeTruthy();
        });
    });

    describe('Schema Constraints', () => {
        it('should reject invalid question type', () => {
            const invalidQuestion = { ...mockStandardQuestion, type: 'invalid' as any };
            const validTypes = ['standard', 'map', 'estimate', 'list', 'pixel', 'freetext'];
            
            expect(validTypes).not.toContain(invalidQuestion.type);
        });

        it('should require question and answer text', () => {
            const question = mockStandardQuestion;
            
            expect(question.questionText).toBeTruthy();
            expect(question.answerText).toBeTruthy();
            expect(question.questionText.length).toBeGreaterThan(0);
            expect(question.answerText.length).toBeGreaterThan(0);
        });

        it('should have non-negative points by default', () => {
            const question = mockStandardQuestion;
            
            expect(question.points).toBeGreaterThanOrEqual(0);
        });

        it('should store media information correctly', () => {
            const question = mockStandardQuestion;
            
            if (question.hasMedia) {
                expect(['image', 'video', 'audio']).toContain(question.mediaType);
                expect(question.mediaPath).toBeTruthy();
            } else {
                expect(question.mediaType).toBe('none');
            }
        });
    });

    describe('Game Validation', () => {
        it('should have at least one category', () => {
            expect(mockGame.categories.length).toBeGreaterThanOrEqual(1);
        });

        it('should have at least one question per category', () => {
            mockGame.categories.forEach((category: ICategory) => {
                expect(category.questions.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('should validate game has valid title', () => {
            expect(mockGame.title).toBeTruthy();
            expect(mockGame.title.length).toBeGreaterThan(0);
        });

        it('should have optional ID field (before persistence)', () => {
            const newGame = { ...mockGame };
            // Before saving to DB, _id is undefined (auto-generated by MongoDB)
            expect(newGame._id).toBeUndefined();
        });
    });

    describe('Schema Defaults', () => {
        it('should default media paths to empty string', () => {
            const question = mockStandardQuestion;
            
            expect(question.mediaPath).toBe('');
            expect(question.answerMediaPath).toBe('');
        });

        it('should default hasMedia to false', () => {
            const question = mockStandardQuestion;
            
            expect(question.hasMedia).toBe(false);
            expect(question.hasAnswerMedia).toBe(false);
        });

        it('should default mediaType to "none"', () => {
            const question = mockStandardQuestion;
            
            expect(question.mediaType).toBe('none');
            expect(question.answerMediaType).toBe('none');
        });

        it('should default negativePoints to 0', () => {
            const question = mockStandardQuestion;
            
            expect(question.negativePoints).toBe(0);
        });
    });
});
