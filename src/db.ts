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

/** Gaya cerita per chat roleplay (Versi 3.1). */
export interface RpStyle {
  pov: 'third' | 'second' | 'first';
  role: 'actor' | 'narrator';
  pace: 'slow' | 'medium' | 'fast';
  register: 'baku' | 'santai' | 'gaul';
  /** Versi 3.3: 'consistent' = suhu tingkat Stabil (lebih patuh pada detail) */
  temp?: 'follow' | 'consistent';
}

/** Potongan avatar dari foto asli, dalam pecahan lebar/tinggi foto (0–1). */
export interface PhotoCrop {
  x: number;
  y: number;
  /** sisi persegi, pecahan dari sisi terpendek foto */
  size: number;
}

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
  /** batas konteks roleplay (token) untuk ringkasan otomatis; 0 = ikuti batas model; kosong = bawaan 32 ribu */
  rpContext?: number;
  rpStyle?: RpStyle;
  /** Versi 3.3: pencatat keadaan adegan dimatikan */
  sceneOff?: boolean;
  /** Versi 3.3: false = memori tidak diperbarui otomatis */
  memoryAuto?: boolean;
  /** chat ini cabang dari chat lain */
  branchOf?: { chatId: string; title: string; seq: number };
  /* ----- Group chat (Versi 3.2) ----- */
  /** anggota grup berurutan (2–5); kosong = chat 1:1 dengan characterId. characterId = anggota pertama. */
  memberIds?: string[];
  /** anggota yang dibisukan sementara */
  muted?: string[];
  turnMode?: 'auto' | 'order' | 'manual';
  /** balasan per giliran (berantai) */
  chain?: 1 | 2 | 3;
  /** menggantikan skenario masing-masing kartu */
  groupScenario?: string;
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
  /** group chat: pembicara versi ini (Tulis ulang sebagai…) */
  speakerId?: string;
  speakerName?: string;
  /** roleplay (3.3): keadaan adegan sesudah versi balasan ini (hanya untuk AI) */
  scene?: string;
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
  /** roleplay: balasan dipotong karena AI mulai menulis giliran pihak lain */
  guardCut?: boolean;
  /** roleplay: pesan disematkan */
  pinned?: boolean;
  /** group chat: karakter yang menulis balasan ini (nama disimpan supaya tetap tampil walau karakter dihapus) */
  speakerId?: string;
  speakerName?: string;
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
  kind: 'notes' | 'summary' | 'rewrite' | 'rp-persona' | 'rp-memory' | 'rp-summary' | 'rp-card' | 'rp-polish' | 'rp-suggest' | 'rp-story' | 'rp-scene';
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
  /** foto asli (sisi terpanjang maks. 1600 px) untuk dilihat utuh; avatar dipotong dari sini */
  photo?: Blob | null;
  crop?: PhotoCrop | null;
  /** model bawaan karakter (kosong = ikuti pengaturan) */
  modelRef?: { provider: string; model: string } | null;
  /** kreativitas khusus karakter (kosong = ikuti pengaturan) */
  creativity?: 'stable' | 'normal' | 'wild' | null;
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
  photo?: Blob | null;
  crop?: PhotoCrop | null;
  description: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** and_any: ada salah satu kata kunci kedua; and_all: semuanya; not_any: tidak ada satu pun; not_all: tidak semuanya. */
export type LoreLogic = 'and_any' | 'and_all' | 'not_any' | 'not_all';

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
  /** kata kunci kedua (kartu SillyTavern: secondary_keys) dan cara memakainya */
  secondaryKeys?: string[];
  logic?: LoreLogic;
  caseSensitive?: boolean;
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

db.version(4).stores({
  chats: 'id, pageId, updatedAt, deletedAt, characterId, *memberIds',
});

/** Versi format file backup. 2 = Versi 3.0.0 (roleplay); versi lama menolak file ini dan meminta update. */
export const SCHEMA_VERSION = 2;
