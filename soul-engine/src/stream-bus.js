/**
 * StreamBus — Dedicated streaming channel for live output.
 *
 * Inspired by DeepTutor's StreamBus/EventBus separation:
 * - EventBus (existing) → state tracking, subsystem coordination
 * - StreamBus (THIS) → live content streaming to UI clients
 *
 * StreamBus handles:
 * - Chat response streaming (token by token)
 * - Recipe execution progress
 * - Research pipeline stages
 * - Any long-running task with intermediate output
 *
 * Clients subscribe to a streamId and receive ordered chunks.
 * Completed streams are kept briefly for late-connecting clients.
 */

import { EventEmitter } from 'events';

const MAX_COMPLETED_STREAMS = 50;
const COMPLETED_STREAM_TTL = 60000; // Keep completed streams for 1 min

export class StreamBus extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
    this.completedStreams = new Map();
    this._streamCount = 0;
  }

  /**
   * Create a new stream.
   *
   * @param {string} type - Stream type ('chat', 'recipe', 'research', 'sandbox')
   * @param {object} metadata - Additional info (capabilityId, sessionId, etc.)
   * @returns {string} streamId
   */
  createStream(type, metadata = {}) {
    const streamId = `stream-${++this._streamCount}-${Date.now()}`;

    this.activeStreams.set(streamId, {
      id: streamId,
      type,
      metadata,
      chunks: [],
      status: 'active',    // active, completed, error
      createdAt: Date.now(),
      completedAt: null,
    });

    this.emit('stream.created', { streamId, type, metadata });
    return streamId;
  }

  /**
   * Push a chunk to a stream (e.g., a token, progress update, or stage result).
   *
   * @param {string} streamId
   * @param {object} chunk
   * @param {string} chunk.type - 'token', 'progress', 'stage', 'result'
   * @param {any} chunk.data - The content
   */
  push(streamId, chunk) {
    const stream = this.activeStreams.get(streamId);
    if (!stream || stream.status !== 'active') return;

    const entry = {
      seq: stream.chunks.length,
      type: chunk.type || 'token',
      data: chunk.data,
      ts: Date.now(),
    };

    stream.chunks.push(entry);
    this.emit('stream.chunk', { streamId, chunk: entry });
  }

  /**
   * Complete a stream (success).
   *
   * @param {string} streamId
   * @param {any} finalResult - Optional final result
   */
  complete(streamId, finalResult = null) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    stream.status = 'completed';
    stream.completedAt = Date.now();
    if (finalResult !== null) {
      stream.chunks.push({
        seq: stream.chunks.length,
        type: 'final',
        data: finalResult,
        ts: Date.now(),
      });
    }

    // Move to completed
    this.activeStreams.delete(streamId);
    this.completedStreams.set(streamId, stream);

    this.emit('stream.completed', { streamId, type: stream.type, chunkCount: stream.chunks.length });

    // Cleanup old completed streams
    this._cleanup();
  }

  /**
   * Error a stream.
   */
  error(streamId, errorMessage) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    stream.status = 'error';
    stream.completedAt = Date.now();
    stream.error = errorMessage;

    this.activeStreams.delete(streamId);
    this.completedStreams.set(streamId, stream);

    this.emit('stream.error', { streamId, error: errorMessage });
    this._cleanup();
  }

  /**
   * Get all chunks for a stream (for late-connecting clients).
   * Works for both active and recently completed streams.
   */
  getStream(streamId) {
    return this.activeStreams.get(streamId) || this.completedStreams.get(streamId) || null;
  }

  /**
   * Get chunks since a sequence number (for replay).
   */
  getChunksSince(streamId, sinceSeq = 0) {
    const stream = this.getStream(streamId);
    if (!stream) return [];
    return stream.chunks.filter(c => c.seq > sinceSeq);
  }

  /**
   * Subscribe a WebSocket to a specific stream.
   * Replays missed chunks and then streams live.
   */
  subscribeWs(ws, streamId, sinceSeq = 0) {
    // Replay missed chunks
    const missed = this.getChunksSince(streamId, sinceSeq);
    for (const chunk of missed) {
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'stream.chunk', streamId, chunk }));
        }
      } catch { /* best-effort */ }
    }

    // Live streaming
    const onChunk = ({ streamId: sid, chunk }) => {
      if (sid !== streamId) return;
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'stream.chunk', streamId, chunk }));
        }
      } catch { /* best-effort */ }
    };

    const onComplete = ({ streamId: sid }) => {
      if (sid !== streamId) return;
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'stream.completed', streamId }));
        }
      } catch { /* best-effort */ }
      cleanup();
    };

    const onError = ({ streamId: sid, error }) => {
      if (sid !== streamId) return;
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'stream.error', streamId, error }));
        }
      } catch { /* best-effort */ }
      cleanup();
    };

    const cleanup = () => {
      this.off('stream.chunk', onChunk);
      this.off('stream.completed', onComplete);
      this.off('stream.error', onError);
    };

    this.on('stream.chunk', onChunk);
    this.on('stream.completed', onComplete);
    this.on('stream.error', onError);
    ws.on('close', cleanup);

    return cleanup;
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      activeStreams: this.activeStreams.size,
      completedStreams: this.completedStreams.size,
      totalCreated: this._streamCount,
    };
  }

  _cleanup() {
    if (this.completedStreams.size <= MAX_COMPLETED_STREAMS) return;

    const cutoff = Date.now() - COMPLETED_STREAM_TTL;
    for (const [id, stream] of this.completedStreams) {
      if (stream.completedAt < cutoff) {
        this.completedStreams.delete(id);
      }
    }
  }
}
