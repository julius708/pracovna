/**
 * The "cat printer" protocol of the X6 label printer (GB01/GB02/X6 family), Martina 2026-10-24.
 * Pure functions only (no Bluetooth, no canvas), so the bytes are unit-testable.
 *
 * Packet: 0x51 0x78 [cmd] 0x00 [len lo] [len hi] [data…] [crc8(data)] 0xFF
 * The print head is 384 dots wide: one row = 48 bytes, 1 bit per dot, 1 = black,
 * least significant bit = leftmost dot.
 */

/** Full 128-bit form of a 16-bit Bluetooth UUID; some browsers (Bluefy) do not take the short number. */
export function bleUuid(short: number): string {
  return `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}

export const PRINTER_SERVICE = bleUuid(0xae30);
/** Commands are written here (write without response). */
export const PRINTER_WRITE_CHAR = bleUuid(0xae01);
/** The printer reports flow control here (0x51 0x78 0xAE … 0x01 = wait, 0x00 = go on). */
export const PRINTER_NOTIFY_CHAR = bleUuid(0xae02);

export const PRINT_WIDTH = 384;
export const ROW_BYTES = PRINT_WIDTH / 8;

export const CMD = {
  feed: 0xa1,
  drawRow: 0xa2,
  deviceState: 0xa3,
  quality: 0xa4,
  lattice: 0xa6,
  energy: 0xaf,
  applyEnergy: 0xbe,
  flowControl: 0xae,
} as const;

const LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];

/** CRC-8, polynomial 0x07, initial value 0, over the data bytes only. */
export function crc8(data: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] & 0xff;
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export function packet(cmd: number, data: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(data.length + 8);
  out.set([0x51, 0x78, cmd, 0x00, data.length & 0xff, (data.length >> 8) & 0xff], 0);
  out.set(Array.from(data), 6);
  out[6 + data.length] = crc8(data);
  out[7 + data.length] = 0xff;
  return out;
}

/** True for the printer's "wait" notification, false for "go on", null for anything else. */
export function flowControlPause(value: ArrayLike<number>): boolean | null {
  if (value.length < 7 || value[0] !== 0x51 || value[1] !== 0x78 || value[2] !== CMD.flowControl) return null;
  return value[6] === 0x01;
}

/**
 * 1-bit rows from RGBA pixels (canvas ImageData layout): a dot is black when its
 * luminance is below `threshold` and it is not transparent.
 */
export function toRows(rgba: ArrayLike<number>, width: number, height: number, threshold = 128): Uint8Array[] {
  if (width !== PRINT_WIDTH) throw new Error(`label must be ${PRINT_WIDTH} px wide, got ${width}`);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(ROW_BYTES);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (rgba[i + 3] >= 128 && lum < threshold) row[x >> 3] |= 1 << (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

/** The whole print job as packets: set up, one packet per row, feed the paper out, finish. */
export function printJob(rows: Uint8Array[], { energy = 0x3000, feedLines = 90 } = {}): Uint8Array[] {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  return [
    packet(CMD.deviceState, [0x00]),
    packet(CMD.quality, [0x33]),
    packet(CMD.energy, u16(energy)),
    packet(CMD.applyEnergy, [0x01]),
    packet(CMD.lattice, LATTICE_START),
    ...rows.map((r) => packet(CMD.drawRow, r)),
    packet(CMD.feed, u16(feedLines)),
    packet(CMD.lattice, LATTICE_END),
    packet(CMD.deviceState, [0x00]),
  ];
}
