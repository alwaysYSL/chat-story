import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type Chat, type Message, type RpStyle } from '../../db';
import { IconClose, IconCopy, IconRetry, IconSparkle } from '../../components/Icons';
import { Sheet, toast } from '../../components/ui';
import { useActiveGen, stopGeneration, UserError } from '../../lib/generate';
import type { ModelRef } from '../../lib/providers';
import { messageText } from '../../lib/rp/context';
import { previewRequest, type RequestPreview } from '../../lib/rp/engine';
import { DEFAULT_STYLE } from '../../lib/rp/prompts';
import { convertToStory, DENSITY, estimateStory, type StoryDensity, type StoryEstimate, type StoryRange } from '../../lib/rp/toStory';
import { markChanged, useSettings } from '../../lib/settings';
import { copyText, formatNumber, formatRupiah, timeAgo } from '../../lib/util';

function errText(e: unknown): string {
  if (e instanceof UserError) return e.message;
  return (e as Error)?.message || String(e);
}

/* ---------- Lihat yang dikirim ke AI ---------- */

export function PreviewSheet({ chatId, text, model, onClose }: { chatId: string; text: string; model: ModelRef | null; onClose: () => void }) {
  const settings = useSettings();
  const [p, setP] = useState<RequestPreview | null | undefined>(undefined);
  useEffect(() => {
    void previewRequest(chatId, text, model).then(setP).catch(() => setP(null));
  }, [chatId, text, model?.provider, model?.model]); // eslint-disable-line react-hooks/exhaustive-deps
  const rate = settings?.usdToIdr ?? 16500;
  return (
    <Sheet open onClose={onClose} title="Yang dikirim ke AI">
      {p === undefined && <p className="note pad">Menyusun…</p>}
      {p === null && <p className="note pad">Gagal menyusun pratinjau.</p>}
      {p && (
        <>
          <p className="note pad">
            Permintaan berikutnya {text.trim() ? 'dengan isi kolom ketik' : '(Lanjutkan)'} untuk {p.model}: ±<b>{formatNumber(p.total)}</b> token
            {p.costUsd !== null ? <> · perkiraan biaya {formatRupiah(p.costUsd * rate)} (bagian awal kena cache)</> : null}.
            {p.pendingSummaries ? ` ${p.pendingSummaries} blok pesan lama akan diringkas dulu (biaya terpisah).` : ''}
          </p>
          {p.parts.map((x) => (
            <details key={x.key} className="preview-part">
              <summary>
                <span>{x.label}</span>
                <small>±{formatNumber(x.tokens)} token</small>
              </summary>
              <pre>{x.text || '(kosong)'}</pre>
            </details>
          ))}
          <div className="row-buttons pad">
            <button
              className="btn"
              onClick={async () => toast((await copyText(p.parts.map((x) => `### ${x.label}\n${x.text}`).join('\n\n'))) ? 'Disalin' : 'Gagal menyalin')}
            >
              <IconCopy size={16} /> Salin semua
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Gaya cerita ---------- */

const STYLE_OPTS: { key: keyof RpStyle; label: string; opts: [string, string][] }[] = [
  { key: 'pov', label: 'Sudut pandang', opts: [['third', 'Orang ketiga'], ['second', 'Orang kedua'], ['first', 'Orang pertama']] },
  { key: 'role', label: 'Peran AI', opts: [['actor', 'Pemeran'], ['narrator', 'Narator / GM']] },
  { key: 'pace', label: 'Tempo', opts: [['slow', 'Lambat'], ['medium', 'Sedang'], ['fast', 'Cepat']] },
  { key: 'register', label: 'Ragam bahasa', opts: [['baku', 'Baku'], ['santai', 'Santai'], ['gaul', 'Gaul']] },
];

export function StyleSheet({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const st = { ...DEFAULT_STYLE, ...chat.rpStyle };
  const set = async (patch: Partial<RpStyle>) => {
    await db.chats.update(chat.id, { rpStyle: { ...st, ...patch } });
    markChanged();
  };
  return (
    <Sheet open onClose={onClose} title="Gaya cerita">
      {STYLE_OPTS.map((g) => (
        <div key={g.key} className="style-group">
          <small>{g.label}</small>
          <div className="segmented sheet-seg">
            {g.opts.map(([v, label]) => (
              <button key={v} className={st[g.key] === v ? 'active' : ''} onClick={() => void set({ [g.key]: v } as Partial<RpStyle>)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="note pad">
        Orang kedua: {'{{user}}'} disebut "kamu". Orang pertama: {'{{char}}'} bercerita sebagai "aku". Narator/GM: AI menggambarkan dunia dan akibat tindakan Anda, dan
        boleh menawarkan pilihan. Tempo dan ragam bahasa dikirim di akhir permintaan, jadi tidak mereset cache; sudut pandang dan peran mengubah instruksi awal (cache
        dimulai ulang sekali).
      </p>
    </Sheet>
  );
}

/* ---------- Pesan tersemat ---------- */

export function PinnedSheet({ messages, fill, names, onJump, onUnpin, onClose }: { messages: Message[]; fill: (t: string) => string; names: { char: string; user: string }; onJump: (m: Message) => void; onUnpin: (m: Message) => void; onClose: () => void }) {
  const pinned = messages.filter((m) => m.pinned);
  return (
    <Sheet open onClose={onClose} title="Pesan tersemat">
      {!pinned.length && <p className="note pad">Belum ada. Tahan pesan → Sematkan. Pesan tersemat yang sudah masuk ringkasan tetap dibaca AI sebagai momen penting.</p>}
      {pinned.map((m) => (
        <div key={m.id} className="summary-row">
          <button className="summary-main" onClick={() => onJump(m)}>
            <b>
              📌 {m.role === 'user' ? names.user : names.char} · {timeAgo(m.createdAt)}
            </b>
            <small className="clamp3">{fill(messageText(m))}</small>
          </button>
          <button className="icon-btn small" aria-label="Lepas semat" onClick={() => onUnpin(m)}>
            <IconClose size={16} />
          </button>
        </div>
      ))}
    </Sheet>
  );
}

/* ---------- Cari di chat ---------- */

export function searchMessages(messages: Message[], q: string, fill: (t: string) => string): Message[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return messages.filter((m) => fill(m.text).toLowerCase().includes(s));
}

export function SearchSheet({ messages, fill, initial, onPick, onClose }: { messages: Message[]; fill: (t: string) => string; initial: string; onPick: (q: string, list: Message[], i: number) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const results = useMemo(() => searchMessages(messages, q, fill), [messages, q, fill]);
  const snippet = (t: string) => {
    const i = t.toLowerCase().indexOf(q.trim().toLowerCase());
    const start = Math.max(0, i - 40);
    return (start ? '…' : '') + t.slice(start, i + q.length + 60).replace(/\s+/g, ' ') + '…';
  };
  return (
    <Sheet open onClose={onClose} title="Cari di chat ini">
      <div className="form-pad">
        <input className="input" autoFocus placeholder="Cari kata di semua pesan" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() && <p className="note pad">{results.length ? `${results.length} pesan` : 'Tidak ditemukan.'}</p>}
      {results.slice(-50).reverse().map((m) => (
        <button key={m.id} className="search-row" onClick={() => onPick(q, results, results.indexOf(m))}>
          <span>
            <b>{m.role === 'user' ? 'Anda' : 'Balasan'}</b>
            <small>{snippet(fill(m.text))}</small>
          </span>
        </button>
      ))}
    </Sheet>
  );
}

/* ---------- Jadikan cerita ---------- */

export function ToStorySheet({
  chat,
  messages,
  model,
  onClose,
  onOpenPage,
}: {
  chat: Chat;
  messages: Message[];
  model: ModelRef | null;
  onClose: () => void;
  onOpenPage: (pageId: string) => void;
}) {
  const settings = useSettings();
  const stories = useLiveQuery(async () => (await db.pages.filter((p) => !p.parentId && !p.deletedAt).toArray()).sort((a, b) => b.updatedAt - a.updatedAt), []);
  const pinned = messages.filter((m) => m.pinned);
  const [rangeKind, setRangeKind] = useState<StoryRange['kind']>('all');
  const [fromSeq, setFromSeq] = useState<number>(pinned[0]?.seq ?? 0);
  const [lastN, setLastN] = useState(60);
  const [targetKind, setTargetKind] = useState<'new' | 'chapter'>('new');
  const [title, setTitle] = useState(chat.title);
  const [rootId, setRootId] = useState('');
  const [density, setDensity] = useState<StoryDensity>('balanced');
  const [est, setEst] = useState<StoryEstimate | null>(null);
  const [result, setResult] = useState<null | { pageId: string; parts: number; stopped: boolean }>(null);
  const [running, setRunning] = useState(false);
  const gen = useActiveGen();
  const range: StoryRange = rangeKind === 'from' ? { kind: 'from', seq: fromSeq } : rangeKind === 'last' ? { kind: 'last', n: lastN } : { kind: 'all' };
  useEffect(() => {
    void estimateStory(chat.id, { range, density }, model).then(setEst);
  }, [chat.id, rangeKind, fromSeq, lastN, density, model?.provider, model?.model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rootId && stories?.length) setRootId(stories[0].id);
  }, [stories, rootId]);
  const rate = settings?.usdToIdr ?? 16500;

  const start = async () => {
    if (!model) {
      toast('Isi API key salah satu penyedia AI dulu di Pengaturan.');
      return;
    }
    if (targetKind === 'chapter' && !rootId) {
      toast('Pilih cerita tujuan.');
      return;
    }
    setRunning(true);
    try {
      const r = await convertToStory(chat.id, { range, density, target: targetKind === 'new' ? { kind: 'new', title } : { kind: 'chapter', rootId } }, model);
      setResult({ pageId: r.firstPageId, parts: r.parts, stopped: r.stopped });
    } catch (e) {
      toast('Gagal: ' + errText(e));
    } finally {
      setRunning(false);
    }
  };

  const convGen = gen?.mode === 'convert' && gen.chatId === chat.id ? gen : null;
  if (running || convGen) {
    return (
      <Sheet open onClose={onClose} title="Menjadikan cerita">
        <p className="note pad">{convGen?.status ?? 'Menyiapkan…'} Tulisan langsung masuk ke page; bagian yang sudah jadi tetap tersimpan kalau dihentikan.</p>
        <div className="assist-live">
          {convGen?.live ? <p>{convGen.live.slice(-600)}</p> : null}
          <span className="typing">
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="row-buttons pad">
          {convGen?.pageId && (
            <button className="btn" onClick={() => onOpenPage(convGen.pageId!)}>
              Lihat page
            </button>
          )}
          <button className="btn btn-danger" onClick={stopGeneration}>
            Stop
          </button>
        </div>
      </Sheet>
    );
  }
  if (result) {
    return (
      <Sheet open onClose={onClose} title="Cerita jadi">
        <p className="note pad">
          {result.parts} bagian ditulis{result.stopped ? ' (dihentikan)' : ''}. Tulisan ini dianggap tulisan Anda, jadi tidak diganti saat Coba lagi. Ask AI di cerita itu bisa
          langsung melanjutkan.
        </p>
        <div className="row-buttons pad">
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
          <button className="btn btn-primary" onClick={() => onOpenPage(result.pageId)}>
            Buka cerita
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Jadikan cerita">
      <div className="form-pad">
        <div className="field">
          <span>Rentang</span>
          <select className="input" value={rangeKind} onChange={(e) => setRangeKind(e.target.value as StoryRange['kind'])}>
            <option value="all">Seluruh chat</option>
            <option value="from" disabled={!pinned.length}>
              Mulai dari pesan tersemat{pinned.length ? '' : ' (belum ada)'}
            </option>
            <option value="last">Beberapa pesan terakhir</option>
          </select>
          {rangeKind === 'from' && (
            <select className="input" value={fromSeq} onChange={(e) => setFromSeq(Number(e.target.value))}>
              {pinned.map((m) => (
                <option key={m.id} value={m.seq}>
                  📌 {m.text.slice(0, 60)}
                </option>
              ))}
            </select>
          )}
          {rangeKind === 'last' && <input className="input num" type="number" min={2} value={lastN} onChange={(e) => setLastN(Math.max(2, Number(e.target.value) || 2))} />}
        </div>
        <div className="field">
          <span>Tujuan</span>
          <div className="segmented sheet-seg">
            <button className={targetKind === 'new' ? 'active' : ''} onClick={() => setTargetKind('new')}>
              Cerita baru
            </button>
            <button className={targetKind === 'chapter' ? 'active' : ''} disabled={!stories?.length} onClick={() => setTargetKind('chapter')}>
              Bab baru di cerita
            </button>
          </div>
          {targetKind === 'new' ? (
            <input className="input" value={title} placeholder="Judul cerita" onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <select className="input" value={rootId} onChange={(e) => setRootId(e.target.value)}>
              {(stories ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.title || 'Tanpa judul'}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field">
          <span>Panjang</span>
          <div className="segmented sheet-seg">
            {(Object.keys(DENSITY) as StoryDensity[]).map((d) => (
              <button key={d} className={density === d ? 'active' : ''} onClick={() => setDensity(d)}>
                {DENSITY[d].label}
              </button>
            ))}
          </div>
          <small>{DENSITY[density].hint}</small>
        </div>
        {est && (
          <p className="note">
            {formatNumber(est.messages)} pesan ({formatNumber(est.words)} kata) → {est.parts} bagian, ±{formatNumber(est.targetWords)} kata prosa
            {est.costUsd !== null ? `, perkiraan biaya ${formatRupiah(est.costUsd * rate)}` : ''}.
          </p>
        )}
      </div>
      <div className="row-buttons pad">
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        <button className="btn btn-primary" disabled={!est?.messages} onClick={() => void start()}>
          <IconSparkle size={16} /> Mulai
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Saran balasan ---------- */

export function SuggestBar({ items, loading, onPick, onRefresh, onClose }: { items: string[]; loading: boolean; onPick: (t: string) => void; onRefresh: () => void; onClose: () => void }) {
  return (
    <div className="rp-suggest" role="list" aria-label="Saran balasan">
      <div className="rp-suggest-head">
        <small>Saran balasan</small>
        <button className="icon-btn small" aria-label="Saran baru" disabled={loading} onClick={onRefresh}>
          <IconRetry size={15} />
        </button>
        <button className="icon-btn small" aria-label="Tutup saran" onClick={onClose}>
          <IconClose size={15} />
        </button>
      </div>
      {loading && !items.length ? (
        <span className="typing">
          <span />
          <span />
          <span />
        </span>
      ) : (
        <div className="rp-suggest-list">
          {items.map((t, i) => (
            <button key={i} role="listitem" className="rp-suggest-item" onClick={() => onPick(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
