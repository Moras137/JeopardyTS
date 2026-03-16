import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { GameModel } from '../../../src/models/Quiz';
import { buildFixtures, type FixtureName } from './db-fixtures';

let mongoServer: MongoMemoryServer | null = null;
let baseUrl = '';
let serverRef: any = null;
let connectDatabaseRef: ((uri?: string) => Promise<void>) | null = null;

export async function startTestServer(): Promise<string> {
    process.env.NODE_ENV = 'test';

    const serverModule = require('../../../src/server');
    connectDatabaseRef = serverModule.connectDatabase;
    serverRef = serverModule.server;

    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }

    if (!connectDatabaseRef) {
        throw new Error('connectDatabase not available from server module');
    }

    await connectDatabaseRef(mongoUri);

    if (!serverRef.listening) {
        await new Promise<void>((resolve) => {
            serverRef.listen(0, () => resolve());
        });
    }

    const addr = serverRef.address();
    if (!addr || typeof addr === 'string') {
        throw new Error('Server address unavailable');
    }

    baseUrl = `http://localhost:${addr.port}`;
    return baseUrl;
}

export function getBaseUrl(): string {
    if (!baseUrl) {
        throw new Error('Test server not started');
    }
    return baseUrl;
}

export async function clearDatabase(): Promise<void> {
    await GameModel.deleteMany({});
}

export async function seedFixtures(only?: FixtureName[]): Promise<Record<FixtureName, string>> {
    const fixtures = buildFixtures();
    const names = (only && only.length > 0 ? only : (Object.keys(fixtures) as FixtureName[]));
    const ids = {} as Record<FixtureName, string>;

    for (const name of names) {
        const doc = await new GameModel(fixtures[name]).save();
        ids[name] = doc._id!.toString();
    }

    return ids;
}

export async function stopTestServer(): Promise<void> {
    await GameModel.deleteMany({});

    if (serverRef && serverRef.listening) {
        await new Promise<void>((resolve, reject) => {
            serverRef.close((err: Error | undefined) => {
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
        mongoServer = null;
    }

    baseUrl = '';
    serverRef = null;
    connectDatabaseRef = null;
}
