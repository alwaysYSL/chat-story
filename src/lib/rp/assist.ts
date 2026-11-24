import type { Character } from '../../db';
import { loadWorld, macro, transcript } from './context';
import { rpAssist } from './engine';
import { FIELD_ACTIONS, SYSTEM_RP_CARD, SYSTEM_RP_FIELD, SYSTEM_RP_PERSONA, SYSTEM_RP_POLISH, SYSTEM_RP_TRANSLATE } from './prompts';

/** Ambil objek JSON dari jawaban model (boleh terbungkus blok kode atau ada teks di sekitarnya). */
export function parseJsonReply(text: string): Record<string, unknown> {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Jawaban AI bukan JSON. Coba lagi.');
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    throw new Error('Jawaban AI tidak bisa dibaca. Coba lagi.');
  }
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

export type CardFields = Pick<Character, 'name' | 'description' | 'personality' | 'scenario' | 'firstMes' | 'altGreetings' | 'mesExample' | 'tags'>;

export async function generateCard(rootId: string, idea: string, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<CardFields> {
  const text = await rpAssist({ rootId, kind: 'rp-card', label: 'Buat karakter dengan AI', system: SYSTEM_RP_CARD, user: `Ide karakter:\n${idea.trim()}`, maxTokens: 3500, onDelta, signal });
  const j = parseJsonReply(text);
  return {
    name: s(j.name).trim(),
    description: s(j.description),
    personality: s(j.personality),
    scenario: s(j.scenario),
    firstMes: s(j.first_mes),
    altGreetings: list(j.alternate_greetings),
    mesExample: s(j.mes_example),
    tags: list(j.tags),
  };
}

export async function generatePersona(idea: string, signal?: AbortSignal): Promise<{ name: string; description: string }> {
  const text = await rpAssist({ rootId: 'persona', kind: 'rp-card', label: 'Buat persona dengan AI', system: SYSTEM_RP_PERSONA, user: `Ide persona:\n${idea.trim()}`, maxTokens: 1200, signal });
  const j = parseJsonReply(text);
  return { name: s(j.name).trim(), description: s(j.description) };
}

export async function translateCard(rootId: string, c: CardFields & Pick<Character, 'creatorNotes' | 'systemPrompt' | 'postHistory'>, signal?: AbortSignal): Promise<Partial<Character>> {
  const input = {
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.firstMes,
    alternate_greetings: c.altGreetings,
    mes_example: c.mesExample,
    creator_notes: c.creatorNotes,
    system_prompt: c.systemPrompt,
    post_history_instructions: c.postHistory,
  };
  const text = await rpAssist({ rootId, kind: 'rp-card', label: `Terjemahkan kartu ${c.name}`, system: SYSTEM_RP_TRANSLATE, user: JSON.stringify(input, null, 1), maxTokens: 8000, signal });
  const j = parseJsonReply(text);
  return {
    description: s(j.description) || c.description,
    personality: s(j.personality) || c.personality,
    scenario: s(j.scenario) || c.scenario,
    firstMes: s(j.first_mes) || c.firstMes,
    altGreetings: list(j.alternate_greetings).length ? list(j.alternate_greetings) : c.altGreetings,
    mesExample: s(j.mes_example) || c.mesExample,
    creatorNotes: s(j.creator_notes) || c.creatorNotes,
    systemPrompt: s(j.system_prompt) || c.systemPrompt,
    postHistory: s(j.post_history_instructions) || c.postHistory,
  };
}

export const FIELD_LABEL: Record<string, string> = {
  description: 'Deskripsi',
  personality: 'Kepribadian',
  scenario: 'Skenario',
  firstMes: 'Pesan pembuka',
  mesExample: 'Contoh dialog',
  persona: 'Deskripsi persona',
};

export async function improveField(
  rootId: string,
  field: string,
  value: string,
  action: keyof typeof FIELD_ACTIONS,
  card: Partial<Character>,
  signal?: AbortSignal,
): Promise<string> {
  const ctx = [
    card.name && `Nama karakter: ${card.name}`,
    field !== 'description' && card.description?.trim() && `Deskripsi karakter:\n${card.description.slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const user = `${ctx ? ctx + '\n\n' : ''}[Kolom: ${FIELD_LABEL[field] ?? field}]\n${value}\n\n${FIELD_ACTIONS[action]}`;
  return rpAssist({ rootId, kind: 'rp-card', label: `${FIELD_LABEL[field] ?? field}: ${action === 'expand' ? 'kembangkan' : action === 'shorten' ? 'persingkat' : 'perbaiki'}`, system: SYSTEM_RP_FIELD, user, maxTokens: 2500, signal });
}

/** Perhalus giliran pengguna dengan konteks beberapa pesan terakhir. */
export async function polishTurn(chatId: string, text: string, signal?: AbortSignal): Promise<string> {
  const w = await loadWorld(chatId);
  if (!w) throw new Error('Chat tidak ditemukan.');
  const recent = w.messages.filter((m) => m.text.trim()).slice(-3);
  const ctx = transcript(w, recent);
  const user = macro(w, `${ctx ? `[Pesan terakhir]\n${ctx}\n\n` : ''}[Giliran {{user}} yang diperhalus]\n${text}`);
  return rpAssist({ rootId: chatId, chatId, kind: 'rp-polish', label: 'Perhalus pesanku', system: macro(w, SYSTEM_RP_POLISH), user, maxTokens: 1200, signal });
}
