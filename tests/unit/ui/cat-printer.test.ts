import { describe, expect, it } from 'vitest';
import { bleUuid, crc8, PRINTER_SERVICE, flowControlPause, packet, printJob, PRINT_WIDTH, ROW_BYTES, toRows } from '@/core/printer/catPrinter';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

describe('cat printer packets', () => {
  // reference packets of the GB01/X6 family as published by the open-source printer drivers
  it('matches the known packets byte for byte', () => {
    expect(hex(packet(0xa3, [0x00]))).toBe('51 78 a3 00 01 00 00 00 ff');
    expect(hex(packet(0xa4, [0x33]))).toBe('51 78 a4 00 01 00 33 99 ff');
    expect(hex(packet(0xa1, [0x30, 0x00]))).toBe('51 78 a1 00 02 00 30 00 f9 ff');
    expect(hex(packet(0xbe, [0x01]))).toBe('51 78 be 00 01 00 01 07 ff');
    expect(hex(packet(0xa6, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]))).toBe(
      '51 78 a6 00 0b 00 aa 55 17 38 44 5f 5f 5f 44 38 2c a1 ff',
    );
    expect(hex(packet(0xa6, [0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17]))).toBe('51 78 a6 00 0b 00 aa 55 17 00 00 00 00 00 00 00 17 11 ff');
  });

  it('names the AE30 service in the full form every browser takes', () => {
    expect(PRINTER_SERVICE).toBe('0000ae30-0000-1000-8000-00805f9b34fb');
    expect(bleUuid(0xae01)).toBe('0000ae01-0000-1000-8000-00805f9b34fb');
  });

  it('crc8 of nothing is 0', () => {
    expect(crc8([])).toBe(0);
  });

  it('reads the flow-control notification', () => {
    expect(flowControlPause([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x01, 0x07, 0xff])).toBe(true);
    expect(flowControlPause([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff])).toBe(false);
    expect(flowControlPause([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff])).toBeNull();
  });
});

describe('label bitmap', () => {
  const blank = (h: number) => new Uint8Array(PRINT_WIDTH * h * 4).fill(255);
  const paint = (px: Uint8Array, x: number, y: number) => px.set([0, 0, 0, 255], (y * PRINT_WIDTH + x) * 4);

  it('one bit per dot, leftmost dot in the lowest bit, 48 bytes a row', () => {
    const px = blank(2);
    paint(px, 0, 0);
    paint(px, 9, 0);
    paint(px, 383, 1);
    const rows = toRows(px, PRINT_WIDTH, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(ROW_BYTES);
    expect(rows[0][0]).toBe(0b00000001);
    expect(rows[0][1]).toBe(0b00000010);
    expect(rows[1][47]).toBe(0b10000000);
    expect(rows[1].slice(0, 47).every((b) => b === 0)).toBe(true);
  });

  it('transparent dots stay white', () => {
    const px = new Uint8Array(PRINT_WIDTH * 4); // all 0 = transparent black
    expect(toRows(px, PRINT_WIDTH, 1)[0].every((b) => b === 0)).toBe(true);
  });

  it('refuses a label of the wrong width', () => {
    expect(() => toRows(new Uint8Array(100 * 4), 100, 1)).toThrow();
  });

  it('a job draws every row and ends with the paper feed', () => {
    const rows = toRows(blank(3), PRINT_WIDTH, 3);
    const job = printJob(rows);
    const draws = job.filter((p) => p[2] === 0xa2);
    expect(draws).toHaveLength(3);
    expect(draws[0]).toHaveLength(ROW_BYTES + 8);
    const feed = job.findIndex((p) => p[2] === 0xa1);
    expect(feed).toBeGreaterThan(job.lastIndexOf(draws[2]));
    expect(job.every((p) => p[0] === 0x51 && p[1] === 0x78 && p[p.length - 1] === 0xff)).toBe(true);
  });
});

describe('label address', () => {
  it('has the street address of a Bratislava flat and none for an unknown one', async () => {
    const { flatAddress } = await import('@/core/printer/addresses');
    expect(flatAddress('6859255a167a6d001324a29a')).toBe('Ventúrska 277/16, 811 01 Bratislava');
    expect(flatAddress('unknown')).toBeNull();
    expect(flatAddress(null)).toBeNull();
  });
});
