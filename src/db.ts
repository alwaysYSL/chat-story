import Dexie, { type EntityTable } from 'dexie';
import type { JSONContent } from '@tiptap/react';

export interface Page {
  id: string;
  /** null = page cerita (induk), terisi = bab (sub-page) */
  parentId: string | null;
  order: number;
  title: string;
  /** true selama judul masih usulan otomatis (boleh ditimpa AI) */
  titleAuto: boolean;
  icon: string;
  pinned: boolean;
  doc: JSONContent;
  /** teks polos untuk pencarian, cuplikan, dan hitung kata */
  text: string;
  words: number;
  scrollY: number;
  /** naik setiap kali isi diubah dari luar editor (AI, versi, batalkan) */
  extRev: number;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  deletedAt: number | null;
  /** Ringkasan bab (Versi 2). Dianggap usang kalau page diubah setelah `at`. */
  summary?: { text: string; at: number };
}

export type ChatKind = 'free' | 'main' | 'discuss' | 'roleplay';
export type RpLength = 'short' | 'normal' | 'long';

export interface Chat {
  id: string;
  title: string;
  titleAuto: boolean;
  kind: ChatKind;
  /** id page cerita (induk) yang terhubung */
  pageId: string | null;
  draft: string;
  /**
   * Pengingat aturan yang ditempel di akhir setiap permintaan menulis.
   * undefined = otomatis diambil dari bagian "aturan lanjutan" di brief; '' = dimatikan.
   */
  reminder?: string;
  /** Catatan cerita (story bible), selalu dikirim ke AI di dekat akhir permintaan. */
  notes?: string;
  notesAt?: number;
  /** page yang tawaran "perbarui catatan" sudah ditutup */
  notesPromptFor?: string;
  /** Ringkasan bab lama: otomatis (dekat batas konteks), selalu, atau mati. */
  summaryMode?: 'auto' | 'always' | 'off';
  /* ----- Roleplay (Versi 3) ----- */
  characterId?: string;
  personaId?: string | null;
  /** memori chat (chat memory) */
  memory?: string;
  /** jumlah pesan saat memori terakhir diperbarui / tawarannya ditutup */
  memoryAtCount?: number;
  rpLength?: RpLength;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type MsgStatus = 'done' | 'streaming' | 'stopped' | 'interrupted' | 'error' | 'canceled';
export type LengthPreset = 'short' | 'normal' | 'long' | 'opening';

export interface Usage {
  hit: number;
  miss: number;
  out: number;
}

export interface Version {
  /** teks mentah persis dari model (dipakai ulang supaya cache tetap kena) */
  raw: string;
  /** hasil serialisasi raw setelah dibersihkan; pembanding dengan isi naskah */
  ser: string;
  words: number;
  usage: Usage;
  costUsd: number;
  /** raw sudah berupa isi naskah bersih (editan penulis / hasil sambungan): jangan dibersihkan ulang */
  clean?: boolean;
}

export interface Message {
  id: string;
  chatId: string;
  seq: number;
  role: 'user' | 'assistant';
  /** teks yang diketik pengguna (atau jawaban AI untuk diskusi) */
  text: string;
  /** isi lampiran teks yang disisipkan ke prompt */
  attachText: string;
  /** instruksi aplikasi yang ditambahkan di belakang pesan pengguna */
  instr: string;
  attachmentIds: string[];
  /** 'roleplay' = pesan chat roleplay (Versi 3) */
  mode: 'write' | 'discuss' | 'roleplay';
  targetPageId: string | null;
  length: LengthPreset | null;
  /** pesan ini membuat page/bab baru */
  createdPageId: string | null;
  /** balasan pembukaan yang diminta menulis "Judul: …" di baris pertama */
  expectTitle: boolean;
  status: MsgStatus;
  error: string | null;
  /** id penyedia di Pengaturan; kosong di data versi pertama (= DeepSeek) */
  provider?: string;
  /** model id yang dikirim ke penyedia */
  model: string;
  thinking: boolean;
  versions: Version[];
  active: number;
  /** total biaya semua versi + percobaan */
  costUsd: number;
  /** ada permintaan yang harganya tidak diketahui (harga model belum diisi) */
  costUnknown?: boolean;
  /** pasangan diskusi ini tidak dikirim lagi ke AI */
  excluded?: boolean;
  /** roleplay: pesan pembuka (versi = pembuka-pembuka kartu) */
  greeting?: boolean;
  /** roleplay: judul entri lorebook yang dikirim saat balasan ini ditulis */
  lore?: string[];
  createdAt: number;
}

export interface Attachment {
  id: string;
  kind: 'image' | 'text';
  name: string;
  mime: string;
  blob: Blob | null;
  text: string | null;
  createdAt: number;
}

/** Biaya permintaan AI di luar chat (catatan cerita, ringkasan bab, tulis ulang, bantuan roleplay). */
export interface UsageLog {
  id: string;
  /** id cerita; untuk roleplay: id chat roleplay atau id karakter */
  rootId: string;
  kind: 'notes' | 'summary' | 'rewrite' | 'rp-persona' | 'rp-memory' | 'rp-summary' | 'rp-card' | 'rp-polish';
  label: string;
  costUsd: number;
  costUnknown: boolean;
  model: string;
  at: number;
}

/* ---------- Roleplay (Versi 3) ---------- */

export interface Character {
  id: string;
  name: string;
  avatar: Blob | null;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  altGreetings: string[];
  mesExample: string;
  systemPrompt: string;
  postHistory: string;
  creatorNotes: string;
  tags: string[];
  /** persona yang otomatis dipakai di chat baru */
  personaId: string | null;
  /** lorebook dunia yang dipasang */
  worldIds: string[];
  /** kolom kartu yang tidak dipakai aplikasi (disimpan untuk ekspor ulang) */
  extra: Record<string, unknown>;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  usedAt: number;
  deletedAt: number | null;
}

export interface Persona {
  id: string;
  name: string;
  avatar: Blob | null;
  description: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LoreEntry {
  id: string;
  title: string;
  keys: string[];
  content: string;
  enabled: boolean;
  /** selalu dikirim (tanpa kata kunci) */
  constant: boolean;
  /** makin besar makin didahulukan saat batas token tercapai */
  priority: number;
  extra?: Record<string, unknown>;
}

export interface Lorebook {
  id: string;
  name: string;
  /** null = lorebook dunia */
  characterId: string | null;
  /** jumlah pesan terakhir yang dipindai kata kuncinya */
  scanDepth: number;
  tokenBudget: number;
  entries: LoreEntry[];
  extra?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Ringkasan satu blok pesan lama di chat roleplay. */
export interface RpSummary {
  id: string;
  chatId: string;
  fromSeq: number;
  toSeq: number;
  /** sidik isi blok; berbeda = pesan di blok diedit/dihapus → ringkasan usang */
  hash: string;
  text: string;
  at: number;
}

export interface KV {
  key: string;
  value: unknown;
}

export const db = new Dexie('chat-story') as Dexie & {
  pages: EntityTable<Page, 'id'>;
  chats: EntityTable<Chat, 'id'>;
  messages: EntityTable<Message, 'id'>;
  attachments: EntityTable<Attachment, 'id'>;
  usage: EntityTable<UsageLog, 'id'>;
  characters: EntityTable<Character, 'id'>;
  personas: EntityTable<Persona, 'id'>;
  lorebooks: EntityTable<Lorebook, 'id'>;
  rpSummaries: EntityTable<RpSummary, 'id'>;
  kv: EntityTable<KV, 'key'>;
};

db.version(1).stores({
  pages: 'id, parentId, updatedAt, openedAt, deletedAt',
  chats: 'id, pageId, updatedAt, deletedAt',
  messages: 'id, chatId, [chatId+seq], status',
  attachments: 'id',
  kv: 'key',
});

db.version(2).stores({
  usage: 'id, rootId, at',
});

db.version(3).stores({
  chats: 'id, pageId, updatedAt, deletedAt, characterId',
  characters: 'id, updatedAt, usedAt, deletedAt',
  personas: 'id, deletedAt',
  lorebooks: 'id, characterId, deletedAt',
  rpSummaries: 'id, chatId',
});

/** Versi format file backup. 2 = Versi 3.0.0 (roleplay); versi lama menolak file ini dan meminta update. */
export const SCHEMA_VERSION = 2;
