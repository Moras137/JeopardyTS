// ========== MOCK SOCKET.IO ==========

export class MockSocket {
    public id: string;
    public listeners: Map<string, Function[]> = new Map();
    public emittedEvents: Array<{ event: string; data: any }> = [];
    public isConnected: boolean = false;

    constructor(id: string = 'mock-socket-' + Math.random()) {
        this.id = id;
    }

    on(event: string, callback: Function) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
        return this;
    }

    off(event: string, callback?: Function) {
        if (!callback) {
            this.listeners.delete(event);
        } else {
            const callbacks = this.listeners.get(event);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) callbacks.splice(index, 1);
            }
        }
        return this;
    }

    emit(event: string, ...args: any[]) {
        this.emittedEvents.push({ event, data: args });
        return this;
    }

    triggerEvent(event: string, ...args: any[]) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(...args));
        }
    }

    getEmittedEvents(event: string) {
        return this.emittedEvents.filter(e => e.event === event);
    }

    clearEmittedEvents() {
        this.emittedEvents = [];
    }

    disconnect() {
        this.isConnected = false;
        this.triggerEvent('disconnect');
    }

    connect() {
        this.isConnected = true;
        this.triggerEvent('connect');
    }
}

// ========== MOCK IO SERVER ==========

export class MockIOServer {
    private rooms: Map<string, MockSocket[]> = new Map();
    private sockets: Map<string, MockSocket> = new Map();
    private listeners: Map<string, Function[]> = new Map();

    to(room: string) {
        return {
            emit: (event: string, ...args: any[]) => {
                const sockets = this.rooms.get(room) || [];
                sockets.forEach(socket => {
                    socket.emit(event, ...args);
                });
            },
        };
    }

    getRoom(room: string): MockSocket[] {
        return this.rooms.get(room) || [];
    }

    addSocketToRoom(socketId: string, room: string) {
        if (!this.rooms.has(room)) {
            this.rooms.set(room, []);
        }
        const socket = this.sockets.get(socketId);
        if (socket && !this.rooms.get(room)!.includes(socket)) {
            this.rooms.get(room)!.push(socket);
        }
    }

    registerSocket(socket: MockSocket) {
        this.sockets.set(socket.id, socket);
    }

    on(event: string, callback: Function) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    getSocket(socketId: string): MockSocket | undefined {
        return this.sockets.get(socketId);
    }

    clearAll() {
        this.rooms.clear();
        this.sockets.clear();
        this.listeners.clear();
    }
}

// ========== SESSION HELPER ==========

export function generateTestRoomCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ========== REQUEST/RESPONSE MOCK ==========

export interface MockRequest {
    body: any;
    params: any;
    query: any;
    headers: any;
}

export interface MockResponse {
    statusCode: number;
    jsonData: any;
    sent: boolean;
    status: (code: number) => MockResponse;
    json: (data: any) => void;
    send: (data: any) => void;
}

export function createMockRequest(body: any = {}, params: any = {}, query: any = {}): MockRequest {
    return {
        body,
        params,
        query,
        headers: { 'content-type': 'application/json' },
    };
}

export function createMockResponse(): MockResponse {
    const response: any = {
        statusCode: 200,
        jsonData: null,
        sent: false,
    };

    response.status = (code: number) => {
        response.statusCode = code;
        return response;
    };

    response.json = (data: any) => {
        response.jsonData = data;
        response.sent = true;
    };

    response.send = (data: any) => {
        response.jsonData = data;
        response.sent = true;
    };

    return response;
}
