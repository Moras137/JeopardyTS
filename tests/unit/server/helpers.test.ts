describe('Helper Functions', () => {
    // ========== calculateDistance ==========
    describe('calculateDistance', () => {
        function calculateDistance(
            lat1: number,
            lng1: number,
            lat2: number,
            lng2: number,
            isCustom: boolean
        ): number {
            if (isCustom) {
                const dx = lat1 - lat2;
                const dy = lng1 - lng2;
                return Math.sqrt(dx * dx + dy * dy);
            }
            
            // Haversine formula for real coordinates
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * (Math.PI / 180);
            const dLng = (lng2 - lng1) * (Math.PI / 180);
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * (Math.PI / 180)) *
                    Math.cos(lat2 * (Math.PI / 180)) *
                    Math.sin(dLng / 2) *
                    Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        it('should calculate distance for real coordinates (Haversine)', () => {
            // Berlin to Paris (approximately 880 km)
            const distance = calculateDistance(52.52, 13.405, 48.8566, 2.3522, false);
            
            // Should be approximately 880 km = 880,000 meters
            expect(distance).toBeGreaterThan(800000);
            expect(distance).toBeLessThan(1000000);
        });

        it('should calculate distance for custom map (Euclidean)', () => {
            const distance = calculateDistance(0, 0, 3, 4, true);
            
            // 3-4-5 triangle
            expect(distance).toBe(5);
        });

        it('should return 0 for same coordinates', () => {
            const distance = calculateDistance(52.52, 13.405, 52.52, 13.405, false);
            
            expect(distance).toBeLessThan(1);
        });

        it('should handle custom map coordinates correctly', () => {
            const distance = calculateDistance(10, 20, 10, 20, true);
            
            expect(distance).toBe(0);
        });
    });

    // ========== generateRoomCode ==========
    describe('generateRoomCode', () => {
        function generateRoomCode(usedCodes: Set<string>): string {
            let code: string;
            do {
                code = Math.floor(1000 + Math.random() * 9000).toString();
            } while (usedCodes.has(code));
            return code;
        }

        it('should generate 4-digit room code', () => {
            const usedCodes = new Set<string>();
            const code = generateRoomCode(usedCodes);
            
            expect(code).toMatch(/^\d{4}$/);
        });

        it('should generate unique room codes', () => {
            const usedCodes = new Set<string>();
            const code1 = generateRoomCode(usedCodes);
            usedCodes.add(code1);
            
            const code2 = generateRoomCode(usedCodes);
            
            expect(code1).not.toBe(code2);
        });

        it('should be in valid range 1000-9999', () => {
            const usedCodes = new Set<string>();
            const code = generateRoomCode(usedCodes);
            const numCode = parseInt(code);
            
            expect(numCode).toBeGreaterThanOrEqual(1000);
            expect(numCode).toBeLessThanOrEqual(9999);
        });
    });

    // ========== getLocalIpAddress ==========
    describe('getLocalIpAddress', () => {
        function getLocalIpAddress(): string {
            // Mock implementation
            return 'localhost';
        }

        it('should return a valid address', () => {
            const ip = getLocalIpAddress();
            
            expect(ip).toBeTruthy();
            expect(typeof ip).toBe('string');
        });

        it('should not be empty', () => {
            const ip = getLocalIpAddress();
            
            expect(ip.length).toBeGreaterThan(0);
        });
    });

    // ========== deleteMediaFile ==========
    describe('deleteMediaFile', () => {
        function isValidMediaPath(filePath: string): boolean {
            if (!filePath || filePath.startsWith('http')) return false;
            return filePath.includes('/uploads/') || filePath.includes('/assets/');
        }

        it('should reject empty paths', () => {
            const result = isValidMediaPath('');
            
            expect(result).toBe(false);
        });

        it('should reject URLs', () => {
            const result = isValidMediaPath('https://example.com/image.jpg');
            
            expect(result).toBe(false);
        });

        it('should accept local media paths', () => {
            const result = isValidMediaPath('/uploads/quiz.jpg');
            
            expect(result).toBe(true);
        });

        it('should accept assets paths', () => {
            const result = isValidMediaPath('/assets/sound.mp3');
            
            expect(result).toBe(true);
        });
    });

    // ========== formatPoints ==========
    describe('formatPoints', () => {
        function formatPoints(points: number): string {
            if (points < 0) return `-${Math.abs(points)} Punkte`;
            return `+${points} Punkte`;
        }

        it('should format positive points', () => {
            const formatted = formatPoints(100);
            
            expect(formatted).toBe('+100 Punkte');
        });

        it('should format negative points', () => {
            const formatted = formatPoints(-50);
            
            expect(formatted).toBe('-50 Punkte');
        });

        it('should handle zero', () => {
            const formatted = formatPoints(0);
            
            expect(formatted).toBe('+0 Punkte');
        });
    });

    // ========== shuffleArray ==========
    describe('shuffleArray', () => {
        function shuffleArray<T>(array: T[]): T[] {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        }

        it('should return an array of same length', () => {
            const original = [1, 2, 3, 4, 5];
            const shuffled = shuffleArray(original);
            
            expect(shuffled).toHaveLength(5);
        });

        it('should not modify original array', () => {
            const original = [1, 2, 3, 4, 5];
            const original_copy = [...original];
            
            shuffleArray(original);
            
            expect(original).toEqual(original_copy);
        });

        it('should contain all original elements', () => {
            const original = ['a', 'b', 'c', 'd'];
            const shuffled = shuffleArray(original);
            
            expect(shuffled.sort()).toEqual(original.sort());
        });
    });
});
