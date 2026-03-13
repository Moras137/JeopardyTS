import { 
    mockStandardQuestion, 
    mockMapQuestion, 
    mockEstimateQuestion,
    mockListQuestion,
    mockPixelQuestion,
    mockFreetextQuestion 
} from '@tests/fixtures/mock-data';

describe('Question Types - Main Branch Support', () => {
    it('should have valid standard question structure', () => {
        expect(mockStandardQuestion.type).toBe('standard');
        expect(mockStandardQuestion.points).toBe(100);
        expect(mockStandardQuestion.questionText).toBeTruthy();
        expect(mockStandardQuestion.answerText).toBeTruthy();
    });

    it('should have valid map question with location', () => {
        expect(mockMapQuestion.type).toBe('map');
        expect(mockMapQuestion.location).toBeDefined();
        expect(mockMapQuestion.location?.lat).toBe(52.52);
        expect(mockMapQuestion.location?.lng).toBe(13.405);
        expect(mockMapQuestion.location?.radius).toBe(100000);
    });

    it('should have valid estimate question with answer value', () => {
        expect(mockEstimateQuestion.type).toBe('estimate');
        expect(mockEstimateQuestion.estimationAnswer).toBe(8000000000);
        expect(mockEstimateQuestion.points).toBe(300);
    });

    it('should have valid list question with items', () => {
        expect(mockListQuestion.type).toBe('list');
        expect(mockListQuestion.listItems).toBeDefined();
        expect(mockListQuestion.listItems).toHaveLength(3);
        expect(mockListQuestion.listItems).toContain('Belgien');
    });

    it('should have valid pixel question with media', () => {
        expect(mockPixelQuestion.type).toBe('pixel');
        expect(mockPixelQuestion.hasMedia).toBe(true);
        expect(mockPixelQuestion.mediaType).toBe('image');
        expect(mockPixelQuestion.pixelConfig).toBeDefined();
        expect(mockPixelQuestion.pixelConfig?.effectType).toBe('pixelate');
        expect(mockPixelQuestion.pixelConfig?.resolutionDuration).toBe(15);
    });

    it('should have valid freetext question', () => {
        expect(mockFreetextQuestion.type).toBe('freetext');
        expect(mockFreetextQuestion.questionText).toBeTruthy();
        expect(mockFreetextQuestion.answerText).toBeTruthy();
    });

    it('should calculate points correctly', () => {
        const allQuestions = [
            mockStandardQuestion,
            mockMapQuestion,
            mockEstimateQuestion,
            mockListQuestion,
            mockPixelQuestion,
            mockFreetextQuestion,
        ];

        const totalPoints = allQuestions.reduce((sum, q) => sum + q.points, 0);
        expect(totalPoints).toBe(1400); // 100+200+300+250+400+150
    });

    it('should handle negative points for map question', () => {
        expect(mockMapQuestion.negativePoints).toBe(-50);
    });

    it('should validate question types are supported', () => {
        const supportedTypes = ['standard', 'map', 'estimate', 'list', 'pixel', 'freetext'];
        const testQuestions = [
            mockStandardQuestion,
            mockMapQuestion,
            mockEstimateQuestion,
            mockListQuestion,
            mockPixelQuestion,
            mockFreetextQuestion,
        ];

        testQuestions.forEach(question => {
            expect(supportedTypes).toContain(question.type);
        });
    });
});

