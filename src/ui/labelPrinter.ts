/**
 * The X6 Bluetooth label printer in the browser (Martina, 2026-10-24): draws the label on a
 * canvas and sends it over Web Bluetooth. The bytes come from src/core/printer/catPrinter.ts.
 */
import { bleUuid, flowControlPause, printJob, PRINT_WIDTH, PRINTER_NOTIFY_CHAR, PRINTER_SERVICE, PRINTER_WRITE_CHAR, toRows } from '@/core/printer/catPrinter';

/* The few Web Bluetooth types used here (TypeScript's DOM library has none). */
interface BtCharacteristic extends EventTarget {
  value?: DataView;
  writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
  writeValue: (v: BufferSource) => Promise<void>;
  startNotifications: () => Promise<BtCharacteristic>;
}
interface BtService {
  getCharacteristic: (uuid: string) => Promise<BtCharacteristic>;
}
interface BtServer {
  connected: boolean;
  connect: () => Promise<BtServer>;
  getPrimaryService: (uuid: string) => Promise<BtService>;
}
interface BtDevice {
  id: string;
  gatt?: BtServer;
}
interface Bluetooth {
  requestDevice: (o: unknown) => Promise<BtDevice>;
  getDevices?: () => Promise<BtDevice[]>;
}

export type LabelError = 'noBluetooth' | 'cancelled' | 'showAll' | 'notConnected' | 'wrongProtocol' | 'failed';
export class LabelPrintError extends Error {
  /** `detail`: the browser's own error ("NotSupportedError: …"), shown small so a failed print can be diagnosed. */
  constructor(
    public code: LabelError,
    public detail: string | null = null,
  ) {
    super(code);
  }
}

function describe(step: string, e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  return `${step}: ${err?.name ?? 'Error'}${err?.message ? ` – ${err.message}` : ''}`;
}

const REMEMBER_KEY = 'pracovna.labelPrinter';
/** Bytes per Bluetooth write: the smallest size every printer and phone accepts. */
const CHUNK = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bluetooth(): Bluetooth | null {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator ? (navigator as unknown as { bluetooth: Bluetooth }).bluetooth : null;
}

export function hasBluetooth(): boolean {
  return bluetooth() !== null;
}

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}
function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBER_KEY, id);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // private mode: the printer is picked again next time
  }
}

/* ---------- the label ---------- */

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const PAD = 12;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(tryLine).width <= maxWidth) line = tryLine;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The label: the flat's name large and bold, Angelika's name for it when there is one, then the flat's address. */
export function drawLabel(name: string, alias: string | null, address: string | null = null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const blocks = [
    { font: `900 44px ${FONT}`, size: 44, text: name },
    ...(alias ? [{ font: `800 32px ${FONT}`, size: 32, text: alias }] : []),
    ...(address ? [{ font: `700 26px ${FONT}`, size: 26, text: address }] : []),
  ];
  const laid = blocks.map((b) => {
    ctx.font = b.font;
    return { ...b, lines: wrap(ctx, b.text, PRINT_WIDTH - 2 * PAD) };
  });
  const lineH = (size: number) => Math.round(size * 1.2);
  const height = PAD * 2 + laid.reduce((h, b, i) => h + b.lines.length * lineH(b.size) + (i ? 8 : 0), 0);
  canvas.width = PRINT_WIDTH;
  canvas.height = height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PRINT_WIDTH, height);
  ctx.fillStyle = '#000';
  // a thin outline around every letter makes the strokes thicker, so they print darker
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.textBaseline = 'top';
  let y = PAD;
  laid.forEach((b, i) => {
    if (i) y += 8;
    ctx.font = b.font;
    for (const line of b.lines) {
      ctx.fillText(line, PAD, y);
      ctx.strokeText(line, PAD, y);
      y += lineH(b.size);
    }
  });
  return canvas;
}

/* ---------- Bluetooth ---------- */

let device: BtDevice | null = null;
let writer: BtCharacteristic | null = null;
let paused = false;

const FAMILY = {
  // AF30: the service many printers of the family announce while their commands live under AE30
  filters: [{ services: [PRINTER_SERVICE] }, { services: [bleUuid(0xaf30)] }, { namePrefix: 'X6' }, { namePrefix: 'GB0' }, { namePrefix: 'GT0' }, { namePrefix: 'MX' }, { namePrefix: 'YT' }],
  optionalServices: [PRINTER_SERVICE],
};
const ALL = { acceptAllDevices: true, optionalServices: [PRINTER_SERVICE] };
/** The family's picker was closed without a printer: the next tap lists every nearby device (Martina, 2026-10-24). */
let showAll = false;

/**
 * The printer picker: printers of the family first; a browser that refuses those filters
 * (Bluefy shows no picker at all, Martina 2026-10-24) gets the plain list of nearby devices.
 */
async function pick(bt: Bluetooth): Promise<BtDevice> {
  let first: unknown;
  const all = showAll;
  showAll = false;
  for (const options of all ? [ALL] : [FAMILY, ALL]) {
    try {
      return await bt.requestDevice(options);
    } catch (e) {
      if ((e as Error)?.name === 'NotFoundError') {
        // closed (or nothing found) in the family's list: offer every device next time
        if (options === FAMILY) {
          showAll = true;
          throw new LabelPrintError('showAll');
        }
        throw new LabelPrintError('cancelled');
      }
      first ??= e;
    }
  }
  throw new LabelPrintError('failed', describe('výber tlačiarne', first));
}

async function open(d: BtDevice): Promise<BtCharacteristic> {
  if (!d.gatt) throw new LabelPrintError('notConnected');
  let server: BtServer;
  try {
    server = d.gatt.connected ? d.gatt : await d.gatt.connect();
  } catch (e) {
    throw new LabelPrintError('notConnected', describe('pripojenie', e));
  }
  // anything other than the AE30 service with its AE01 write characteristic is not this protocol: stop
  let service: BtService;
  let char: BtCharacteristic;
  try {
    service = await server.getPrimaryService(PRINTER_SERVICE);
    char = await service.getCharacteristic(PRINTER_WRITE_CHAR);
  } catch (e) {
    throw new LabelPrintError('wrongProtocol', describe('služba AE30/AE01', e));
  }
  try {
    const notify = await service.getCharacteristic(PRINTER_NOTIFY_CHAR);
    notify.addEventListener('characteristicvaluechanged', (ev) => {
      const v = (ev.target as BtCharacteristic).value;
      if (!v) return;
      const p = flowControlPause(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (p !== null) paused = p;
    });
    await notify.startNotifications();
  } catch {
    // no flow control on this printer: the pacing below has to do
  }
  return char;
}

/** The printer to use: the one already connected, the remembered one, or one the user picks now. */
async function connect(onConnecting: () => void): Promise<BtCharacteristic> {
  const bt = bluetooth();
  if (!bt) throw new LabelPrintError('noBluetooth');
  if (writer && device?.gatt?.connected) return writer;
  if (!device) {
    const id = remembered();
    if (id && bt.getDevices) device = (await bt.getDevices().catch(() => [])).find((d) => d.id === id) ?? null;
  }
  const known = device !== null;
  if (!device) device = await pick(bt);
  onConnecting();
  try {
    writer = await open(device);
  } catch (e) {
    // a remembered printer that does not answer: forget it, the next tap offers the picker
    if (known) remember(null);
    device = null;
    writer = null;
    throw e;
  }
  remember(device.id);
  return writer;
}

/**
 * Every packet (one label row) waits for the printer to confirm it: sent unconfirmed, Bluefy dropped
 * parts of rows and the label came out striped (Martina, 2026-10-24). A printer that refuses
 * confirmed writes gets small unconfirmed pieces with a pause instead.
 */
let confirmed = true;

async function sendPacket(char: BtCharacteristic, packet: Uint8Array<ArrayBuffer>) {
  if (confirmed) {
    try {
      await char.writeValue(packet);
      return;
    } catch (e) {
      if (!char.writeValueWithoutResponse) throw e;
      confirmed = false;
    }
  }
  for (let i = 0; i < packet.length; i += CHUNK) {
    await char.writeValueWithoutResponse!(packet.slice(i, i + CHUNK));
    await sleep(12);
  }
}

async function send(char: BtCharacteristic, packets: Uint8Array[]) {
  for (const p of packets) {
    for (let waited = 0; paused && waited < 5000; waited += 20) await sleep(20);
    await sendPacket(char, p as Uint8Array<ArrayBuffer>);
  }
}

/** Prints the flat's label; throws LabelPrintError. */
export async function printLabel(name: string, alias: string | null, address: string | null, onConnecting: () => void = () => {}): Promise<void> {
  // pick the printer first: the browser allows the picker only right after the tap
  let char: BtCharacteristic;
  try {
    char = await connect(onConnecting);
  } catch (e) {
    throw e instanceof LabelPrintError ? e : new LabelPrintError('failed', describe('pripojenie', e));
  }
  let packets: Uint8Array[];
  try {
    const canvas = drawLabel(name, alias, address);
    const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    packets = printJob(toRows(img.data, img.width, img.height, 170));
  } catch (e) {
    throw new LabelPrintError('failed', describe('kreslenie štítka', e));
  }
  paused = false;
  try {
    await send(char, packets);
  } catch (e) {
    writer = null;
    throw new LabelPrintError('failed', describe('posielanie do tlačiarne', e));
  }
}
