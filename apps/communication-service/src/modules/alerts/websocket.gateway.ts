import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

// ---------------------------------------------------------------------------
// Socket.IO types are defined locally to avoid requiring @types/socket.io in
// the service layer. The real Socket / Server classes from socket.io satisfy
// these interfaces at runtime; tests can inject plain object mocks.
// ---------------------------------------------------------------------------

export interface ISocket {
  id: string;
  handshake: {
    query: Record<string, string | string[] | undefined>;
  };
  join(room: string): void;
  disconnect(close?: boolean): void;
}

export interface IServer {
  to(room: string): { emit(event: string, data: unknown): void };
}

/**
 * AlertsWebSocketGateway exposes the `/alerts` Socket.IO namespace.
 *
 * Connection lifecycle:
 *  1. Client connects with query param `rm_id` (e.g. `ws://host:3003/alerts?rm_id=RM001`).
 *  2. Gateway joins the client socket to room `rm:{rm_id}`.
 *  3. AlertDispatcherService calls `sendToRM(rmId, event, data)` which emits
 *     to the room — all connected clients for that RM receive the event.
 *
 * Security note: for production, validate the rm_id against a session token
 * before joining the room. The current implementation trusts the query param
 * (acceptable for internal intranet deployment behind API gateway).
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/alerts' })
export class AlertsWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AlertsWebSocketGateway.name);

  @WebSocketServer()
  server!: IServer;

  /**
   * Handles a new WebSocket connection.
   *
   * Extracts `rm_id` from the socket query string and joins the client to
   * the corresponding room so it receives targeted alerts.
   */
  handleConnection(client: ISocket): void {
    const rmId = this.extractRmId(client);

    if (!rmId) {
      this.logger.warn(
        `WebSocket connection rejected: missing rm_id query param socket_id=${client.id}`,
      );
      client.disconnect(true);
      return;
    }

    const room = `rm:${rmId}`;
    client.join(room);
    this.logger.log(`WebSocket connected socket_id=${client.id} rm_id=${rmId} room=${room}`);
  }

  /**
   * Handles WebSocket disconnection — logged for observability.
   */
  handleDisconnect(client: ISocket): void {
    const rmId = this.extractRmId(client);
    this.logger.log(`WebSocket disconnected socket_id=${client.id} rm_id=${rmId ?? 'unknown'}`);
  }

  /**
   * Emit an event to all WebSocket connections belonging to an RM.
   *
   * @param rmId   Target RM identifier (matches the room `rm:{rmId}`).
   * @param event  Socket.IO event name (e.g. 'new_alert').
   * @param data   Payload to send — must be JSON-serialisable.
   */
  sendToRM(rmId: string, event: string, data: unknown): void {
    const room = `rm:${rmId}`;
    this.server.to(room).emit(event, data);
    this.logger.debug(`Emitted event=${event} to room=${room}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractRmId(client: ISocket): string | undefined {
    const raw = client.handshake?.query?.['rm_id'];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  }
}
