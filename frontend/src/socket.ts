import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents } from '../../src/types'; // Import aus dem Backend-Ordner!

// Der Socket ist nun streng typisiert!
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();