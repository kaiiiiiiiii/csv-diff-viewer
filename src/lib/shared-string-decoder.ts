/**
 * Utility for decoding strings from SharedArrayBuffer
 *
 * TextDecoder cannot decode directly from SharedArrayBuffer.
 * This utility provides a workaround by copying the buffer when necessary.
 */

export class SharedStringDecoder {
  private static utf8Decoder = new TextDecoder("utf-8");

  /**
   * Decode string from Uint8Array that may be backed by SharedArrayBuffer
   */
  static decode(buffer: Uint8Array): string {
    // Check if the buffer is shared
    if (this.isSharedArrayBuffer(buffer.buffer)) {
      return this.decodeFromShared(buffer);
    }

    // Regular ArrayBuffer, decode directly
    return this.utf8Decoder.decode(buffer);
  }

  /**
   * Decode string from SharedArrayBuffer-backed Uint8Array
   */
  private static decodeFromShared(buffer: Uint8Array): string {
    // Fast path: check if all ASCII (most CSV data is ASCII)
    if (this.isAscii(buffer)) {
      return this.decodeAscii(buffer);
    }

    // For UTF-8, we need to copy - but only the minimal necessary
    const tempBuffer = new Uint8Array(buffer.length);
    tempBuffer.set(buffer);
    return this.utf8Decoder.decode(tempBuffer);
  }

  /**
   * Check if buffer is backed by SharedArrayBuffer
   */
  private static isSharedArrayBuffer(buffer: ArrayBufferLike): boolean {
    return buffer instanceof SharedArrayBuffer;
  }

  /**
   * Check if buffer contains only ASCII characters (0-127)
   */
  private static isAscii(buffer: Uint8Array): boolean {
    // Quick check for non-ASCII bytes
    for (const byte of buffer) {
      if (byte > 127) {
        return false;
      }
    }
    return true;
  }

  /**
   * Convert ASCII bytes to string without TextDecoder to keep SharedArrayBuffer zero-copy
   */
  private static decodeAscii(buffer: Uint8Array): string {
    if (buffer.length === 0) {
      return "";
    }

    const chunkSize = 0x8000; // avoid call stack limits for large buffers
    let result = "";
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
      result += String.fromCharCode(...chunk);
    }
    return result;
  }

  /**
   * Decode in chunks to minimize memory usage for large buffers
   */
  static decodeFromSharedChunked(buffer: Uint8Array, chunkSize = 4096): string {
    if (!this.isSharedArrayBuffer(buffer.buffer)) {
      return this.utf8Decoder.decode(buffer);
    }

    let result = "";
    const decoder = new TextDecoder();

    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
      const tempChunk = new Uint8Array(chunk.length);
      tempChunk.set(chunk);

      // Use stream mode for proper UTF-8 handling across chunks
      const isLast = i + chunkSize >= buffer.length;
      result += decoder.decode(tempChunk, { stream: !isLast });
    }

    return result;
  }
}
