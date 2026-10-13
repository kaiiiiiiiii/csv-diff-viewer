/**
 * Utility for decoding strings from SharedArrayBuffer
 *
 * TextDecoder cannot decode directly from SharedArrayBuffer-backed views, so
 * those are copied into a regular buffer first. Regular buffers are decoded
 * straight from the given view.
 */

const utf8Decoder = new TextDecoder("utf-8");

export class SharedStringDecoder {
  /**
   * Decode string from Uint8Array that may be backed by SharedArrayBuffer
   */
  static decode(buffer: Uint8Array): string {
    if (buffer.length === 0) return "";
    if (this.isSharedArrayBuffer(buffer.buffer)) {
      // Non-shared copy of just this view
      return utf8Decoder.decode(new Uint8Array(buffer));
    }
    return utf8Decoder.decode(buffer);
  }

  /**
   * Check if buffer is backed by SharedArrayBuffer (false where unsupported)
   */
  private static isSharedArrayBuffer(buffer: ArrayBufferLike): boolean {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      buffer instanceof SharedArrayBuffer
    );
  }

  /**
   * Decode in chunks to minimize memory usage for large buffers
   */
  static decodeFromSharedChunked(buffer: Uint8Array, chunkSize = 4096): string {
    if (!this.isSharedArrayBuffer(buffer.buffer)) {
      return utf8Decoder.decode(buffer);
    }

    let result = "";
    // Own decoder: streaming state must not leak into the shared instance
    const decoder = new TextDecoder();

    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = new Uint8Array(
        buffer.subarray(i, Math.min(i + chunkSize, buffer.length)),
      );
      const isLast = i + chunkSize >= buffer.length;
      result += decoder.decode(chunk, { stream: !isLast });
    }

    return result;
  }
}
