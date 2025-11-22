/**
 * Binary decoder for WASM diff results.
 *
 * This module provides zero-copy binary decoding for diff results,
 * eliminating JSON serialization overhead.
 *
 * Binary format matches src-wasm/src/binary.rs:
 *
 * Header (20 bytes):
 * - total_rows: u32 (4 bytes)
 * - added_count: u32 (4 bytes)
 * - removed_count: u32 (4 bytes)
 * - modified_count: u32 (4 bytes)
 * - unchanged_count: u32 (4 bytes)
 *
 * For each row:
 * - row_type: u8 (1 = added, 2 = removed, 3 = modified, 4 = unchanged)
 * - key_len: u32
 * - key: UTF-8 bytes
 * - Row data (varies by type)
 */

export interface DiffResult {
  added: Array<AddedRow>;
  removed: Array<RemovedRow>;
  modified: Array<ModifiedRow>;
  unchanged: Array<UnchangedRow>;
  source?: DatasetMetadata;
  target?: DatasetMetadata;
  keyColumns?: Array<string>;
  excludedColumns?: Array<string>;
  mode?: string;
}

export interface DatasetMetadata {
  headers: Array<string>;
  rows: Array<Record<string, string>>;
}

export interface AddedRow {
  key: string;
  targetRow: Record<string, string>;
}

export interface RemovedRow {
  key: string;
  sourceRow: Record<string, string>;
}

export interface ModifiedRow {
  key: string;
  sourceRow: Record<string, string>;
  targetRow: Record<string, string>;
  differences: Array<Difference>;
}

export interface UnchangedRow {
  key: string;
  row: Record<string, string>;
}

export interface Difference {
  column: string;
  oldValue: string;
  newValue: string;
  diff?: Array<DiffChange>;
}

export interface DiffChange {
  added: boolean;
  removed: boolean;
  value: string;
}

export class BinaryDecoder {
  private buffer: Uint8Array;
  private view: DataView;
  private position: number;
  private textDecoder: TextDecoder;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.buffer =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.buffer.byteLength,
    );
    this.position = 0;
    this.textDecoder = new TextDecoder();
  }

  /**
   * Decode the entire binary diff result.
   */
  decode(): DiffResult {
    // Read header
    const totalRows = this.readU32();
    const addedCount = this.readU32();
    const removedCount = this.readU32();
    const modifiedCount = this.readU32();
    const unchangedCount = this.readU32();

    const result: DiffResult = {
      added: [],
      removed: [],
      modified: [],
      unchanged: [],
    };

    // Read added rows
    for (let i = 0; i < addedCount; i++) {
      const rowType = this.readU8(); // Should be 1
      const key = this.readString();
      const targetRow = this.readRowData();
      result.added.push({ key, targetRow });
    }

    // Read removed rows
    for (let i = 0; i < removedCount; i++) {
      const rowType = this.readU8(); // Should be 2
      const key = this.readString();
      const sourceRow = this.readRowData();
      result.removed.push({ key, sourceRow });
    }

    // Read modified rows
    for (let i = 0; i < modifiedCount; i++) {
      const rowType = this.readU8(); // Should be 3
      const key = this.readString();
      const sourceRow = this.readRowData();
      const targetRow = this.readRowData();

      const diffCount = this.readU32();
      const differences: Array<Difference> = [];
      for (let j = 0; j < diffCount; j++) {
        const column = this.readString();
        const oldValue = this.readString();
        const newValue = this.readString();
        differences.push({ column, oldValue, newValue });
      }

      result.modified.push({ key, sourceRow, targetRow, differences });
    }

    // Read unchanged rows
    for (let i = 0; i < unchangedCount; i++) {
      const rowType = this.readU8(); // Should be 4
      const key = this.readString();
      const row = this.readRowData();
      result.unchanged.push({ key, row });
    }

    return result;
  }

  /**
   * Read a single byte (u8).
   */
  private readU8(): number {
    if (this.position >= this.buffer.length) {
      throw new Error(
        `Buffer overflow: attempted to read at position ${this.position}, buffer length ${this.buffer.length}`,
      );
    }
    const value = this.buffer[this.position];
    this.position += 1;
    return value;
  }

  /**
   * Read a 32-bit unsigned integer (u32) in little-endian format.
   */
  private readU32(): number {
    if (this.position + 4 > this.buffer.length) {
      throw new Error(
        `Buffer overflow: attempted to read u32 at position ${this.position}, buffer length ${this.buffer.length}`,
      );
    }
    const value = this.view.getUint32(this.position, true); // true = little-endian
    this.position += 4;
    return value;
  }

  /**
   * Read a UTF-8 string with length prefix.
   */
  private readString(): string {
    const length = this.readU32();
    if (this.position + length > this.buffer.length) {
      throw new Error(
        `Buffer overflow: attempted to read ${length} bytes at position ${this.position}, buffer length ${this.buffer.length}`,
      );
    }
    const bytes = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return this.textDecoder.decode(bytes);
  }

  /**
   * Read row data (HashMap<String, String>).
   */
  private readRowData(): Record<string, string> {
    const fieldCount = this.readU32();
    const row: Record<string, string> = {};
    for (let i = 0; i < fieldCount; i++) {
      const key = this.readString();
      const value = this.readString();
      row[key] = value;
    }
    return row;
  }
}

/**
 * Decode binary diff result from WASM memory.
 *
 * @param wasmMemory - The WASM module's memory buffer
 * @param ptr - Pointer to the binary data
 * @param length - Length of the binary data
 * @returns Decoded diff result
 */
export function decodeBinaryResult(
  wasmMemory: WebAssembly.Memory,
  ptr: number,
  length: number,
): DiffResult {
  const buffer = new Uint8Array(wasmMemory.buffer, ptr, length);
  const decoder = new BinaryDecoder(buffer);
  return decoder.decode();
}
