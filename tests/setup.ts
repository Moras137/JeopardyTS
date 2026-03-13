// Jest Setup File
beforeAll(() => {
    console.log('🧪 Test Suite Starting...');
});

afterEach(() => {
    jest.clearAllMocks();
});

afterAll(() => {
    console.log('✅ Test Suite Complete!');
});

// Globale Test-Timeouts
jest.setTimeout(10000);
