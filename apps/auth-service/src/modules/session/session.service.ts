import { Injectable, Inject, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RMIdentity, SessionData } from '../sso/sso.types';

// ---------------------------------------------------------------------------
// Minimal interface contracts for injected infrastructure clients.
//
// Defined locally (NOT imported from ioredis / mongoose) so that this service
// is fully testable without those packages being installed.  The real clients
// satisfy these interfaces at runtime; tests inject plain object mocks.
// ---------------------------------------------------------------------------

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<'OK' | unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface ISessionModel {
  create(doc: Partial<SessionDocument>): Promise<SessionDocument>;
  findOne(filter: Partial<SessionDocument>): Promise<SessionDocument | null>;
  updateOne(filter: Partial<SessionDocument>, update: Record<string, unknown>): Promise<unknown>;
}

export interface SessionDocument {
  session_id: string;
  rm_id: string;
  rm_name: string;
  rm_code: string;
  rm_email: string;
  rm_branch: string;
  rm_region: string;
  role: string;
  expires_at: Date;
  created_at_ts: Date;
  status: string;
}

// ---------------------------------------------------------------------------
// DI injection tokens
// ---------------------------------------------------------------------------
export const SESSION_REDIS_CLIENT = Symbol('SESSION_REDIS_CLIENT');
export const SESSION_MODEL = Symbol('SESSION_MODEL');

/** Default session TTL: 24 hours in seconds */
const DEFAULT_SESSION_TTL = 86400;

/**
 * Redis key factory — centralised so all session key lookups are consistent.
 */
const sessionKey = (sessionId: string): string => `session:${sessionId}`;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(SESSION_REDIS_CLIENT) private readonly redis: IRedisClient,
    @Inject(SESSION_MODEL) private readonly sessionModel: ISessionModel,
    @Inject('SESSION_TTL') private readonly sessionTtl: number,
  ) {}

  /**
   * Create a new session for the given RM identity.
   *
   * Write-through pattern: MongoDB (durable) is written first, then Redis
   * (cache) is populated. If Redis write fails the session is still persisted.
   *
   * @param rmIdentity  Validated RM identity from SsoService.
   * @returns           Newly generated session_id.
   */
  async createSession(rmIdentity: RMIdentity): Promise<string> {
    const session_id = rmIdentity.session_id || uuidv4();
    const now = new Date();
    const ttl = this.sessionTtl || DEFAULT_SESSION_TTL;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const sessionDoc: Partial<SessionDocument> = {
      session_id,
      rm_id: rmIdentity.rm_id,
      rm_name: rmIdentity.rm_name,
      rm_code: rmIdentity.rm_code,
      rm_email: rmIdentity.rm_email,
      rm_branch: rmIdentity.rm_branch,
      rm_region: rmIdentity.rm_region,
      role: rmIdentity.role,
      expires_at: expiresAt,
      created_at_ts: now,
      status: 'active',
    };

    // 1. Persist to MongoDB first (source of truth)
    try {
      await this.sessionModel.create(sessionDoc);
      this.logger.log(`Session persisted to MongoDB: session_id=${session_id} rm_id=${rmIdentity.rm_id}`);
    } catch (err) {
      this.logger.error(`MongoDB session create failed: ${(err as Error).message}`);
      throw err;
    }

    // 2. Populate Redis cache (best-effort — failure does not abort the request)
    const sessionData: SessionData = {
      session_id,
      rm_identity: {
        ...rmIdentity,
        session_id,
        token_expires: expiresAt.toISOString(),
      },
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'active',
    };

    try {
      await this.redis.setex(sessionKey(session_id), ttl, JSON.stringify(sessionData));
      this.logger.debug(`Session cached in Redis: ${sessionKey(session_id)} TTL=${ttl}s`);
    } catch (err) {
      this.logger.warn(`Redis session cache write failed (session still in MongoDB): ${(err as Error).message}`);
    }

    return session_id;
  }

  /**
   * Retrieve session data by session ID.
   *
   * Read-through pattern: Redis is checked first for low-latency retrieval.
   * On a Redis miss the session is fetched from MongoDB and re-hydrated into
   * Redis so subsequent reads are served from cache.
   *
   * @param sessionId  The session UUID to look up.
   * @returns          SessionData if found, null otherwise.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    // 1. Try Redis (fast path)
    try {
      const raw = await this.redis.get(sessionKey(sessionId));
      if (raw !== null) {
        this.logger.debug(`Session cache HIT: session_id=${sessionId}`);
        return JSON.parse(raw) as SessionData;
      }
    } catch (err) {
      this.logger.warn(`Redis get failed for session_id=${sessionId}: ${(err as Error).message}`);
    }

    this.logger.debug(`Session cache MISS: session_id=${sessionId} — querying MongoDB`);

    // 2. Fall back to MongoDB
    let doc: SessionDocument | null = null;
    try {
      doc = await this.sessionModel.findOne({ session_id: sessionId });
    } catch (err) {
      this.logger.error(`MongoDB session lookup failed: ${(err as Error).message}`);
      return null;
    }

    if (!doc) {
      this.logger.debug(`Session not found in MongoDB: session_id=${sessionId}`);
      return null;
    }

    // 3. Re-hydrate Redis cache from MongoDB record
    const ttl = this.sessionTtl || DEFAULT_SESSION_TTL;
    const sessionData: SessionData = {
      session_id: doc.session_id,
      rm_identity: {
        rm_id: doc.rm_id,
        rm_name: doc.rm_name,
        rm_code: doc.rm_code,
        rm_email: doc.rm_email,
        rm_branch: doc.rm_branch,
        rm_region: doc.rm_region,
        role: doc.role as 'RM' | 'BM' | 'ADMIN',
        client_count: 0,
        session_id: doc.session_id,
        token_expires: doc.expires_at.toISOString(),
      },
      created_at: doc.created_at_ts.toISOString(),
      expires_at: doc.expires_at.toISOString(),
      status: doc.status as 'active' | 'expired' | 'revoked',
    };

    try {
      await this.redis.setex(sessionKey(sessionId), ttl, JSON.stringify(sessionData));
      this.logger.debug(`Session re-hydrated in Redis: session_id=${sessionId}`);
    } catch (err) {
      this.logger.warn(`Redis re-hydration failed for session_id=${sessionId}: ${(err as Error).message}`);
    }

    return sessionData;
  }

  /**
   * Invalidate a session — removes from Redis and marks MongoDB record as
   * expired so the session is no longer resurrectable from the backup store.
   *
   * @param sessionId  The session UUID to invalidate.
   */
  async invalidateSession(sessionId: string): Promise<void> {
    // Delete from Redis
    try {
      await this.redis.del(sessionKey(sessionId));
      this.logger.debug(`Session evicted from Redis: session_id=${sessionId}`);
    } catch (err) {
      this.logger.warn(`Redis session eviction failed for session_id=${sessionId}: ${(err as Error).message}`);
    }

    // Mark as expired in MongoDB
    try {
      await this.sessionModel.updateOne(
        { session_id: sessionId },
        { $set: { status: 'expired' } },
      );
      this.logger.log(`Session invalidated in MongoDB: session_id=${sessionId}`);
    } catch (err) {
      this.logger.error(`MongoDB session invalidation failed for session_id=${sessionId}: ${(err as Error).message}`);
    }
  }
}
