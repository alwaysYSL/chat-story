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
}

export type ChatKind = 'free' | 'main' | 'discuss';

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
  mode: 'write' | 'discuss';
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

export interface KV {
  key: string;
  value: unknown;
}

export const db = new Dexie('chat-story') as Dexie & {
  pages: EntityTable<Page, 'id'>;
  chats: EntityTable<Chat, 'id'>;
  messages: EntityTable<Message, 'id'>;
  attachments: EntityTable<Attachment, 'id'>;
  kv: EntityTable<KV, 'key'>;
};

db.version(1).stores({
  pages: 'id, parentId, updatedAt, openedAt, deletedAt',
  chats: 'id, pageId, updatedAt, deletedAt',
  messages: 'id, chatId, [chatId+seq], status',
  attachments: 'id',
  kv: 'key',
});

export const SCHEMA_VERSION = 1;
