import { db, type Chat, type Message } from '../db';
import type { ApiMessage, ContentPart } from './api';
import { groupSegments, serializeBlocks, docBlocks } from './markdown';
import { getStoryPages, displayTitle } from './pages';
import { chapterMarker, SYSTEM_DISCUSS, SYSTEM_MAIN } from './prompts';
import { blobToDataUrl } from './util';

export function composeUser(m: Pick<Message, 'text' | 'attachText' | 'instr'>): string {
  return [m.text, m.attachText, m.instr].filter((s) => s && s.trim()).join('\n\n');
}

export interface BuiltContext {
  messages: ApiMessage[];
  imagesOmitted: number;
}

export async function messageContent(m: Message, vision: boolean, omitted: { n: number }): Promise<string | ContentPart[]> {
  const text = composeUser(m);
  if (!m.attachmentIds.length) return text;
  const parts: ContentPart[] = [{ type: 'text', text }];
  for (const id of m.attachmentIds) {
    const a = await db.attachments.get(id);
    if (!a || a.kind !== 'image' || !a.blob) continue;
    if (!vision) {
      omitted.n++;
      continue;
    }
    parts.push({ type: 'image_url', image_url: { url: await blobToDataUrl(a.blob) } });
  }
  return parts.length === 1 ? text : parts;
}

/** Gabungkan pesan berurutan dengan peran sama (API lebih stabil dengan peran bergantian). */
export function mergeSameRole(list: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of list) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && m.role !== 'system') {
      const toParts = (c: string | ContentPart[]): ContentPart[] =>
        typeof c === 'string' ? [{ type: 'text', text: c }] : c;
      if (typeof prev.content === 'string' && typeof m.content === 'string') {
        prev.content = prev.content + '\n\n' + m.content;
      } else {
        prev.content = [...toParts(prev.content), ...toParts(m.content)];
      }
    } else out.push({ ...m });
  }
  return out;
}

interface Unit {
  key: [number, number, number];
  msgs: ApiMessage[];
}

/**
 * Brief = pesan pertama yang dikirim dalam mode tulis (yang tidak dibatalkan).
 * Pesan diskusi sebelum cerita dimulai tidak dihitung sebagai brief.
 */
export function findBrief(list: Message[]): Message | undefined {
  const writes = list.filter((m) => m.role === 'user' && m.mode === 'write');
  return writes.find((m) => m.status !== 'canceled') ?? writes[0];
}

/**
 * Susun konteks chat utama/bebas:
 * system → brief → (giliran user/assistant sesuai urutan bab, dengan penanda awal tiap bab) → …
 *
 * - Brief SELALU dikirim, walaupun pembukaannya sudah dihapus dari naskah.
 * - Balasan AI diambil dari isi naskah terbaru; kalau belum diedit, teks mentah model dipakai
 *   supaya awalan permintaan identik dan kena cache.
 * - Pasangan tulis yang balasannya sudah tidak ada di naskah dilewati.
 * - Pasangan diskusi yang dikeluarkan pengguna (excluded) dilewati.
 *
 * `beforeSeq`: hanya pesan dengan seq < beforeSeq yang dipakai.
 */
export async function buildMainContext(chat: Chat, vision: boolean, beforeSeq = Infinity): Promise<BuiltContext> {
  const all = await db.messages.where('chatId').equals(chat.id).sortBy('seq');
  const msgs = all.filter((m) => m.seq < beforeSeq);
  const brief = findBrief(all);
  const pages = chat.pageId ? await getStoryPages(chat.pageId) : [];
  const pageIdx = new Map(pages.map((p, i) => [p.id, i]));
  const groups = pages.map((p) => groupSegments(p.doc));
  const segIndex = new Map<string, { page: number; first: number; text: string }>();
  groups.forEach((g, pi) => {
    g.segs.forEach((v, seg) => {
      const text = serializeBlocks(v.blocks);
      if (text.trim()) segIndex.set(seg, { page: pi, first: v.first, text });
    });
  });

  const omitted = { n: 0 };
  const units: Unit[] = [];
  let lastKey: [number, number] = [-1, -1];
  const pagesWithContent = new Set<number>();

  // Teks manual sebelum segmen AI pertama di setiap page.
  groups.forEach((g, pi) => {
    const text = serializeBlocks(g.leading);
    if (!text.trim()) return;
    pagesWithContent.add(pi);
    const label = pi === 0 ? 'Naskah awal' : `Bab "${displayTitle(pages[pi])}"`;
    units.push({
      key: [pi, -1, -1],
      msgs: [{ role: 'user', content: `[Teks yang ditulis penulis sendiri — ${label}]\n\n${text}` }],
    });
  });

  for (let i = 0; i < msgs.length; i++) {
    const u = msgs[i];
    if (u.role !== 'user') continue;
    const a = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : undefined;
    const isBrief = u.id === brief?.id;

    if (isBrief) {
      // Brief selalu di paling awal. Balasannya (pembukaan) diletakkan sesuai posisinya di naskah.
      const seg = a && a.status !== 'canceled' ? segIndex.get(a.id) : undefined;
      const usable = seg && (!a!.targetPageId || pageIdx.has(a!.targetPageId));
      units.push({
        // Sebelum seluruh naskah; diskusi yang terjadi sebelum brief tetap di depannya.
        key: [-1, -1, u.seq],
        // Instruksi pembukaan hanya relevan kalau pembukaannya masih ada.
        msgs: [{ role: 'user', content: await messageContent(usable ? u : { ...u, instr: '' }, vision, omitted) }],
      });
      if (usable && seg && a) {
        const v = a.versions[a.active];
        lastKey = [seg.page, seg.first];
        pagesWithContent.add(seg.page);
        units.push({ key: [seg.page, seg.first, u.seq], msgs: [{ role: 'assistant', content: v && v.ser === seg.text ? v.raw : seg.text }] });
      }
      continue;
    }

    if (u.status === 'canceled' || a?.status === 'canceled') continue;
    if (!a) continue;

    if (u.mode === 'write') {
      const seg = segIndex.get(a.id);
      if (!seg) continue; // balasan sudah dihapus dari naskah, atau page-nya di Sampah
      if (a.targetPageId && !pageIdx.has(a.targetPageId)) continue;
      const v = a.versions[a.active];
      const content = v && v.ser === seg.text ? v.raw : seg.text;
      lastKey = [seg.page, seg.first];
      pagesWithContent.add(seg.page);
      units.push({
        key: [seg.page, seg.first, u.seq],
        msgs: [
          { role: 'user', content: await messageContent(u, vision, omitted) },
          { role: 'assistant', content },
        ],
      });
    } else {
      if (u.excluded || a.excluded || !a.text.trim()) continue;
      units.push({
        key: [lastKey[0], lastKey[1], u.seq],
        msgs: [
          { role: 'user', content: await messageContent(u, vision, omitted) },
          { role: 'assistant', content: a.text },
        ],
      });
    }
  }

  // Penanda awal setiap bab yang punya isi, supaya AI tahu batas dan judul bab.
  for (const pi of pagesWithContent) {
    if (pi === 0) continue;
    units.push({ key: [pi, -2, -2], msgs: [{ role: 'user', content: chapterMarker(displayTitle(pages[pi])) }] });
  }

  units.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1] || x.key[2] - y.key[2]);
  const messages = mergeSameRole([{ role: 'system', content: SYSTEM_MAIN }, ...units.flatMap((u) => u.msgs)]);
  return { messages, imagesOmitted: omitted.n };
}

/** Konteks chat diskusi: brief + seluruh naskah di awal, lalu percakapan. */
export async function buildDiscussContext(chat: Chat, vision: boolean, beforeSeq = Infinity): Promise<BuiltContext> {
  const omitted = { n: 0 };
  const head: ApiMessage[] = [{ role: 'system', content: SYSTEM_DISCUSS }];
  if (chat.pageId) {
    const pages = await getStoryPages(chat.pageId);
    const main = (await db.chats.where('pageId').equals(chat.pageId).toArray()).find(
      (c) => c.kind === 'main' && !c.deletedAt,
    );
    let briefMsg: Message | undefined;
    if (main) {
      briefMsg = findBrief(await db.messages.where('chatId').equals(main.id).sortBy('seq'));
    }
    const naskah = pages
      .map((p, i) => {
        const body = serializeBlocks(docBlocks(p.doc));
        return i === 0 ? `# ${displayTitle(p)}\n\n${body}` : `## ${displayTitle(p)}\n\n${body}`;
      })
      .join('\n\n');
    const intro = `[Brief cerita dari penulis]\n\n${briefMsg ? [briefMsg.text, briefMsg.attachText].filter(Boolean).join('\n\n') : '(tidak ada brief)'}\n\n[Naskah cerita saat ini]\n\n${naskah}`;
    if (briefMsg && briefMsg.attachmentIds.length) {
      const content = await messageContent({ ...briefMsg, text: intro, attachText: '', instr: '' }, vision, omitted);
      head.push({ role: 'user', content });
    } else head.push({ role: 'user', content: intro });
  }
  const all = await db.messages.where('chatId').equals(chat.id).sortBy('seq');
  const rest: ApiMessage[] = [];
  for (const m of all) {
    if (m.seq >= beforeSeq || m.status === 'canceled' || m.excluded) continue;
    if (m.role === 'user') rest.push({ role: 'user', content: await messageContent(m, vision, omitted) });
    else if (m.text.trim()) rest.push({ role: 'assistant', content: m.text });
  }
  // Pastikan tidak ada pesan user tanpa balasan di tengah (gagal) yang membingungkan.
  return { messages: mergeSameRole([...head, ...rest]), imagesOmitted: omitted.n };
}

export async function buildContext(chat: Chat, vision: boolean, beforeSeq = Infinity): Promise<BuiltContext> {
  return chat.kind === 'discuss' ? buildDiscussContext(chat, vision, beforeSeq) : buildMainContext(chat, vision, beforeSeq);
}

/** Brief chat utama (pesan tulis pertama). */
export async function getBrief(chatId: string): Promise<Message | undefined> {
  return findBrief(await db.messages.where('chatId').equals(chatId).sortBy('seq'));
}
