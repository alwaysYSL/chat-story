import type { Character, LoreEntry, LoreLogic, Lorebook } from '../../db';
import { uid } from '../util';

/**
 * Kartu karakter format komunitas (Character Card V1/V2/V3, dipakai SillyTavern, Chub, dll.).
 * - PNG: data kartu disimpan di chunk teks `chara` (V2, base64 JSON) dan/atau `ccv3` (V3).
 * - JSON: objek kartu langsung.
 */

/* ---------- Penanda {{char}} / {{user}} ---------- */

export function fillMacros(text: string, charName: string, userName: string): string {
  return text
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, charName)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, userName);
}

/* ---------- PNG ---------- */

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(b: Uint8Array): boolean {
  return PNG_SIG.every((v, i) => b[i] === v);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const out = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Semua chunk teks (tEXt, zTXt, iTXt) di file PNG: keyword → teks. */
export async function pngTextChunks(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isPng(bytes)) return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin = new TextDecoder('latin1');
  const utf8 = new TextDecoder();
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = latin.decode(bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IEND') break;
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue;
    const z = data.indexOf(0);
    if (z < 0) continue;
    const key = latin.decode(data.subarray(0, z));
    try {
      if (type === 'tEXt') out.set(key, latin.decode(data.subarray(z + 1)));
      else if (type === 'zTXt') out.set(key, latin.decode(await inflate(data.subarray(z + 2))));
      else {
        const compressed = data[z + 1] === 1;
        let p = z + 3;
        const lang = data.indexOf(0, p);
        const trans = data.indexOf(0, lang + 1);
        p = trans + 1;
        const body = data.subarray(p);
        out.set(key, utf8.decode(compressed ? await inflate(body) : body));
      }
    } catch {
      /* chunk rusak: lewati */
    }
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Sisipkan chunk tEXt sebelum IEND (chunk teks lama dengan keyword yang sama dibuang). */
export function pngWithText(bytes: Uint8Array, entries: Record<string, string>): Uint8Array {
  const latin = new TextDecoder('latin1');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = latin.decode(bytes.subarray(pos + 4, pos + 8));
    const whole = bytes.subarray(pos, pos + 12 + len);
    if (type === 'IEND') {
      for (const [k, v] of Object.entries(entries)) {
        const kb = new TextEncoder().encode(k);
        const vb = new TextEncoder().encode(v); // base64: hanya ASCII
        const data = new Uint8Array(kb.length + 1 + vb.length);
        data.set(kb, 0);
        data.set(vb, kb.length + 1);
        parts.push(chunk('tEXt', data));
      }
      parts.push(whole);
      break;
    }
    if (type === 'tEXt') {
      const data = bytes.subarray(pos + 8, pos + 8 + len);
      const key = latin.decode(data.subarray(0, Math.max(0, data.indexOf(0))));
      if (!(key in entries)) parts.push(whole);
    } else parts.push(whole);
    pos += 12 + len;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ---------- Kartu ↔ karakter ---------- */

type Json = Record<string, unknown>;
/** urutan nilai selectiveLogic di SillyTavern */
const ST_LOGIC: LoreLogic[] = ['and_any', 'not_all', 'not_any', 'and_all'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []) as string[];

/** Kolom kartu yang dipetakan ke kolom aplikasi; sisanya masuk `extra`. */
const KNOWN = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'alternate_greetings',
  'tags',
  'character_book',
]);

export interface ImportedCard {
  character: Omit<Character, 'avatar' | 'createdAt' | 'updatedAt' | 'usedAt'>;
  lorebook: Omit<Lorebook, 'createdAt' | 'updatedAt'> | null;
  /** kartu V1/V2/V3 */
  spec: string;
}

export function parseCardJson(raw: unknown): ImportedCard {
  if (!raw || typeof raw !== 'object') throw new Error('Isi kartu tidak valid.');
  const obj = raw as Json;
  const spec = str(obj.spec) || 'v1';
  const data = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Json;
  const name = str(data.name).trim() || str(obj.name).trim() || str(obj.char_name).trim();
  if (!name) throw new Error('Kartu tidak punya nama karakter.');
  const extra: Json = { spec, spec_version: obj.spec_version };
  for (const [k, v] of Object.entries(data)) if (!KNOWN.has(k)) extra[k] = v;
  const id = uid();
  const character: ImportedCard['character'] = {
    id,
    name,
    description: str(data.description) || str(obj.char_persona),
    personality: str(data.personality),
    scenario: str(data.scenario) || str(obj.world_scenario),
    firstMes: str(data.first_mes) || str(obj.char_greeting),
    altGreetings: arr(data.alternate_greetings).filter((g) => g.trim()),
    mesExample: str(data.mes_example) || str(obj.example_dialogue),
    systemPrompt: str(data.system_prompt),
    postHistory: str(data.post_history_instructions),
    creatorNotes: str(data.creator_notes),
    tags: arr(data.tags),
    personaId: null,
    worldIds: [],
    extra,
    pinned: false,
    deletedAt: null,
  };
  let lorebook: ImportedCard['lorebook'] = null;
  const book = data.character_book as Json | undefined;
  if (book && typeof book === 'object' && Array.isArray(book.entries)) {
    const entries: LoreEntry[] = [];
    (book.entries as Json[]).forEach((e, i) => {
      if (!e || typeof e !== 'object') return;
      const content = str(e.content);
      if (!content.trim()) return;
      const { keys, content: _c, enabled, constant, name: n, comment, priority, insertion_order, secondary_keys, selective, case_sensitive, ...rest } = e;
      void _c;
      const ext = (e.extensions && typeof e.extensions === 'object' ? e.extensions : {}) as Json;
      const secondaryKeys = arr(secondary_keys);
      entries.push({
        id: uid(),
        title: str(n) || str(comment) || arr(keys)[0] || `Entri ${i + 1}`,
        keys: arr(keys),
        content,
        enabled: enabled !== false,
        constant: constant === true,
        priority: typeof priority === 'number' ? priority : typeof insertion_order === 'number' ? insertion_order : 100,
        // SillyTavern: kata kunci kedua hanya berlaku kalau "selective"; logikanya di extensions.selectiveLogic.
        ...(selective !== false && secondaryKeys.length ? { secondaryKeys, logic: ST_LOGIC[Number(ext.selectiveLogic) || 0] ?? 'and_any' } : {}),
        ...(case_sensitive === true || ext.case_sensitive === true ? { caseSensitive: true } : {}),
        extra: { ...rest, ...(selective === false && secondaryKeys.length ? { secondary_keys: secondaryKeys, selective: false } : {}) },
      });
    });
    const { entries: _e, name: bn, scan_depth, token_budget, ...rest } = book;
    void _e;
    lorebook = {
      id: uid(),
      name: str(bn) || `Lorebook ${name}`,
      characterId: id,
      scanDepth: typeof scan_depth === 'number' && scan_depth > 0 ? Math.min(20, scan_depth) : 4,
      tokenBudget: typeof token_budget === 'number' && token_budget > 0 ? Math.min(8000, token_budget) : 1500,
      entries,
      extra: rest,
      deletedAt: null,
    };
  }
  return { character, lorebook, spec };
}

/** Baca file kartu (PNG atau JSON). PNG juga mengembalikan gambarnya untuk avatar. */
export async function readCardFile(file: File): Promise<ImportedCard & { image: Blob | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) {
    const chunks = await pngTextChunks(bytes);
    const raw = chunks.get('ccv3') ?? chunks.get('chara');
    if (!raw) throw new Error('Gambar PNG ini tidak berisi data kartu karakter.');
    let json: unknown;
    try {
      json = JSON.parse(b64ToUtf8(raw));
    } catch {
      throw new Error('Data kartu di PNG ini rusak.');
    }
    return { ...parseCardJson(json), image: new Blob([bytes as BlobPart], { type: 'image/png' }) };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('File ini bukan kartu karakter (PNG atau JSON).');
  }
  return { ...parseCardJson(json), image: null };
}

/** Karakter → kartu V2 (dipakai juga untuk V3 di PNG, dengan spec diganti). */
export function toCardV2(c: Character, book: Lorebook | null): Json {
  const { spec: _s, spec_version: _v, ...extra } = c.extra ?? {};
  void _s;
  void _v;
  const data: Json = {
    ...extra,
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.firstMes,
    mes_example: c.mesExample,
    creator_notes: c.creatorNotes,
    system_prompt: c.systemPrompt,
    post_history_instructions: c.postHistory,
    alternate_greetings: c.altGreetings,
    tags: c.tags,
    creator: (extra.creator as string) ?? '',
    character_version: (extra.character_version as string) ?? '',
    extensions: (extra.extensions as Json) ?? {},
  };
  if (book && book.entries.length) {
    data.character_book = {
      ...(book.extra ?? {}),
      name: book.name,
      scan_depth: book.scanDepth,
      token_budget: book.tokenBudget,
      extensions: (book.extra?.extensions as Json) ?? {},
      entries: book.entries.map((e, i) => ({
        ...(e.extra ?? {}),
        keys: e.keys,
        content: e.content,
        enabled: e.enabled,
        constant: e.constant,
        name: e.title,
        priority: e.priority,
        insertion_order: e.priority,
        id: i,
        ...(e.secondaryKeys?.length ? { secondary_keys: e.secondaryKeys, selective: true } : {}),
        ...(e.caseSensitive ? { case_sensitive: true } : {}),
        extensions: {
          ...((e.extra?.extensions as Json) ?? {}),
          ...(e.secondaryKeys?.length ? { selectiveLogic: Math.max(0, ST_LOGIC.indexOf(e.logic ?? 'and_any')) } : {}),
          ...(e.caseSensitive ? { case_sensitive: true } : {}),
        },
      })),
    };
  }
  return { spec: 'chara_card_v2', spec_version: '2.0', data };
}

export function cardJsonBlob(c: Character, book: Lorebook | null): Blob {
  return new Blob([JSON.stringify(toCardV2(c, book), null, 2)], { type: 'application/json' });
}

export async function cardPngBlob(c: Character, book: Lorebook | null): Promise<Blob> {
  const png = new Uint8Array(await (await avatarPng(c)).arrayBuffer());
  const v2 = toCardV2(c, book);
  const v3 = { ...v2, spec: 'chara_card_v3', spec_version: '3.0' };
  const out = pngWithText(png, { chara: utf8ToB64(JSON.stringify(v2)), ccv3: utf8ToB64(JSON.stringify(v3)) });
  return new Blob([out as BlobPart], { type: 'image/png' });
}

/* ---------- Avatar ---------- */

const AVATAR_SIDE = 512;

/** Potong persegi di tengah dan perkecil. */
export async function makeAvatar(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(AVATAR_SIDE, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar'))), 'image/jpeg', 0.88),
  );
}

/** Gambar PNG untuk kartu: avatar, atau kotak berisi huruf awal nama. */
async function avatarPng(c: Character): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const pic = c.photo ?? c.avatar;
  if (pic) {
    // Foto asli dengan proporsi aslinya (sisi terpanjang maks. 1024 px), seperti kartu Chub/SillyTavern.
    const bmp = await createImageBitmap(pic);
    const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
  } else {
    canvas.width = AVATAR_SIDE;
    canvas.height = Math.round(AVATAR_SIDE * 1.5);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6e6e5';
    ctx.font = `bold ${AVATAR_SIDE / 3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(c.name), canvas.width / 2, canvas.height / 2);
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat PNG'))), 'image/png'));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function cardFileName(name: string, ext: 'png' | 'json'): string {
  const base = name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'karakter';
  return `${base}.${ext}`;
}

/* ---------- depth_prompt (catatan karakter SillyTavern) ---------- */

/** Teks `extensions.depth_prompt.prompt` dari kartu. */
export function depthPrompt(c: Pick<Character, 'extra'>): string {
  const ext = c.extra?.extensions as Record<string, unknown> | undefined;
  const dp = ext?.depth_prompt as { prompt?: unknown } | undefined;
  return typeof dp?.prompt === 'string' ? dp.prompt : '';
}

export function withDepthPrompt(c: Character, text: string): Character {
  const ext = { ...((c.extra?.extensions as Record<string, unknown>) ?? {}) };
  const prev = (ext.depth_prompt as Record<string, unknown>) ?? { depth: 4, role: 'system' };
  if (text.trim()) ext.depth_prompt = { ...prev, prompt: text };
  else delete ext.depth_prompt;
  return { ...c, extra: { ...c.extra, extensions: ext } };
}
