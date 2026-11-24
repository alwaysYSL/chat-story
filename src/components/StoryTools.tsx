import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, type Page } from '../db';
import {
  AUTO_SUMMARY_RATIO,
  KEEP_FULL,
  proposeNotes,
  REWRITE_PRESETS,
  rewriteSelection,
  saveSummary,
  summarizePage,
  summaryStale,
} from '../lib/assist';
import { UserError } from '../lib/generate';
import { displayTitle, getMainChat } from '../lib/pages';
import { markChanged } from '../lib/settings';
import { countWords, formatNumber, timeAgo } from '../lib/util';
import { MarkdownView } from './Blocks';
import { IconChevron, IconRetry, IconSparkle } from './Icons';
import { Sheet, SheetItem, toast } from './ui';

function errText(e: unknown): string {
  if (e instanceof UserError) return e.message;
  return (e as Error)?.message || String(e);
}

/* ---------- Catatan cerita ---------- */

/** Lihat & edit catatan cerita; bisa minta AI memperbaruinya dari satu bab. */
export function NotesSheet({ rootId, open, onClose, fromPageId }: { rootId: string; open: boolean; onClose: () => void; fromPageId?: string }) {
  const chat = useLiveQuery(async () => (open ? ((await getMainChat(rootId)) ?? null) : null), [open, rootId]);
  const pages = useLiveQuery(
    async () =>
      open
        ? [
            ...(await db.pages.where('id').equals(rootId).toArray()),
            ...(await db.pages.where('parentId').equals(rootId).toArray()).filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order),
          ]
        : [],
    [open, rootId],
  );
  const [text, setText] = useState('');
  const [choose, setChoose] = useState(false);
  const [propose, setPropose] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!open) {
      loaded.current = false;
      setPropose(null);
      setChoose(false);
      return;
    }
    if (chat && !loaded.current) {
      setText(chat.notes ?? '');
      loaded.current = true;
      // Dibuka dari "Perbarui catatan dari bab ini": langsung minta usulan AI.
      if (fromPageId) setPropose(fromPageId);
    }
  }, [open, chat, fromPageId]);

  const save = async (v: string) => {
    if (!chat) return;
    await db.chats.update(chat.id, { notes: v.trim(), notesAt: Date.now(), updatedAt: Date.now() });
    markChanged();
  };

  if (!open) return null;
  if (chat === null) {
    return (
      <Sheet open onClose={onClose} title="Catatan cerita">
        <p className="note pad">Catatan cerita dibuat setelah cerita punya chat utama. Ketuk Ask AI dan tulis brief dulu.</p>
      </Sheet>
    );
  }
  return (
    <>
      <Sheet open={!propose && !choose} onClose={onClose} title="Catatan cerita">
        <p className="note pad">
          Fakta yang harus konsisten (karakter, hubungan, latar, status terkini). Selalu dibaca AI saat menulis. Tulis sendiri, atau minta AI
          memperbaruinya dari satu bab.
        </p>
        <textarea
          className="input textarea-md"
          value={text}
          placeholder={'mis.\nKarakter:\n- Anggi: vokalis, kidal, takut ketinggian\n- Rika: gitaris, pindahan dari Bandung'}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row-buttons pad">
          <button className="btn" onClick={() => (fromPageId ? setPropose(fromPageId) : setChoose(true))}>
            <IconSparkle size={16} /> Perbarui dari bab
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await save(text);
              toast('Catatan disimpan');
              onClose();
            }}
          >
            Simpan
          </button>
        </div>
      </Sheet>
      <Sheet open={choose} onClose={() => setChoose(false)} title="Perbarui dari bab">
        {(pages ?? [])
          .filter((p) => p.text.trim())
          .map((p, i) => (
            <SheetItem
              key={p.id}
              icon={<IconChevron />}
              label={i === 0 ? `${displayTitle(p)} (pembukaan)` : displayTitle(p)}
              hint={`${formatNumber(p.words)} kata`}
              onClick={() => {
                setChoose(false);
                setPropose(p.id);
              }}
            />
          ))}
      </Sheet>
      {propose && (
        <ProposeNotes
          rootId={rootId}
          pageId={propose}
          current={text}
          onClose={() => setPropose(null)}
          onAccept={async (v) => {
            setText(v);
            await save(v);
            setPropose(null);
            toast('Catatan diperbarui');
          }}
        />
      )}
    </>
  );
}

function ProposeNotes({
  rootId,
  pageId,
  current,
  onClose,
  onAccept,
}: {
  rootId: string;
  pageId: string;
  current: string;
  onClose: () => void;
  onAccept: (v: string) => void;
}) {
  const [live, setLive] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    ctrl.current = c;
    setLive('');
    setResult(null);
    setError(null);
    // Catatan yang sedang diedit (belum disimpan) dipakai sebagai catatan lama.
    void (async () => {
      const chat = await getMainChat(rootId);
      if (chat && current !== (chat.notes ?? '')) await db.chats.update(chat.id, { notes: current.trim() });
      try {
        const t = await proposeNotes(rootId, pageId, setLive, c.signal);
        if (!c.signal.aborted) setResult(t);
      } catch (e) {
        if (!c.signal.aborted) setError(errText(e));
      }
    })();
    return () => c.abort();
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open onClose={onClose} title="Usulan catatan baru">
      {error && <p className="note pad err">Gagal: {error}</p>}
      {result === null && !error && (
        <div className="assist-live">
          {live ? <MarkdownView text={live} /> : null}
          <span className="typing">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
      {result !== null && (
        <>
          <p className="note pad">Periksa dan ubah kalau perlu, lalu terima. Catatan lama diganti.</p>
          <textarea className="input textarea-md" value={result} onChange={(e) => setResult(e.target.value)} />
        </>
      )}
      <div className="row-buttons pad">
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        {(result !== null || error) && (
          <button className="btn" onClick={() => setRun((n) => n + 1)}>
            <IconRetry size={16} /> Coba lagi
          </button>
        )}
        {result !== null && (
          <button className="btn btn-primary" disabled={!result.trim()} onClick={() => onAccept(result)}>
            Terima
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- Ringkasan bab lama ---------- */

const MODE_LABEL = { auto: 'Otomatis', always: 'Selalu', off: 'Mati' } as const;

export function SummariesSheet({ rootId, open, onClose }: { rootId: string; open: boolean; onClose: () => void }) {
  const data = useLiveQuery(async () => {
    if (!open) return null;
    const chat = (await getMainChat(rootId)) ?? null;
    const root = await db.pages.get(rootId);
    const ch = (await db.pages.where('parentId').equals(rootId).toArray()).filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order);
    return { chat, pages: root ? [root, ...ch] : ch };
  }, [open, rootId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Page | null>(null);
  if (!open || !data) return null;
  const mode = data.chat?.summaryMode ?? 'auto';
  const make = async (p: Page) => {
    setBusy(p.id);
    try {
      await summarizePage(rootId, p.id);
      toast('Ringkasan dibuat');
    } catch (e) {
      toast('Gagal: ' + errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Sheet open={!edit} onClose={onClose} title="Ringkasan bab lama">
        <p className="note pad">
          Untuk cerita panjang, bab lama dikirim ke AI sebagai ringkasan supaya muat di batas konteks model. {KEEP_FULL} bab terakhir selalu
          dikirim utuh.
        </p>
        <div className="segmented sheet-seg">
          {(['auto', 'always', 'off'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'active' : ''}
              disabled={!data.chat}
              onClick={async () => {
                if (!data.chat) return;
                await db.chats.update(data.chat.id, { summaryMode: m, updatedAt: Date.now() });
                markChanged();
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="note pad">
          {mode === 'auto'
            ? `Otomatis: dipakai kalau cerita sudah melewati ${Math.round(AUTO_SUMMARY_RATIO * 100)}% batas konteks model. Ringkasan dibuat otomatis saat dibutuhkan.`
            : mode === 'always'
              ? 'Selalu: bab lama selalu dikirim sebagai ringkasan (lebih hemat, tapi AI tidak membaca detail bab lama).'
              : 'Mati: semua bab selalu dikirim utuh.'}
        </p>
        {data.pages.map((p, i) => {
          const status = !p.text.trim() ? 'kosong' : !p.summary ? 'belum ada ringkasan' : summaryStale(p) ? 'perlu diperbarui (bab diubah)' : `diringkas ${timeAgo(p.summary.at)}`;
          return (
            <div key={p.id} className="summary-row">
              <button className="summary-main" disabled={!p.summary} onClick={() => setEdit(p)}>
                <b>{i === 0 ? `${displayTitle(p)} (pembukaan)` : displayTitle(p)}</b>
                <small>
                  {formatNumber(p.words)} kata · {status}
                  {i >= data.pages.length - KEEP_FULL ? ' · dikirim utuh' : ''}
                </small>
              </button>
              {p.text.trim() && (
                <button className="btn btn-small" disabled={!!busy} onClick={() => void make(p)}>
                  {busy === p.id ? 'Meringkas…' : p.summary ? 'Perbarui' : 'Buat'}
                </button>
              )}
            </div>
          );
        })}
      </Sheet>
      {edit && <EditSummary page={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EditSummary({ page, onClose }: { page: Page; onClose: () => void }) {
  const [text, setText] = useState(page.summary?.text ?? '');
  return (
    <Sheet open onClose={onClose} title={`Ringkasan ${displayTitle(page)}`}>
      <textarea className="input textarea-md" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="note pad">{countWords(text)} kata. Perubahan dipakai di permintaan AI berikutnya.</p>
      <div className="row-buttons pad">
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        <button
          className="btn btn-primary"
          disabled={!text.trim()}
          onClick={async () => {
            await saveSummary(page.id, text);
            toast('Ringkasan disimpan');
            onClose();
          }}
        >
          Simpan
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Tulis ulang teks terpilih ---------- */

export interface RewriteTarget {
  rootId: string;
  before: string;
  selected: string;
  after: string;
}

export function RewriteSheet({ target, onClose, onReplace }: { target: RewriteTarget; onClose: () => void; onReplace: (text: string) => void }) {
  const [instruction, setInstruction] = useState('');
  const [live, setLive] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const lastInstr = useRef('');
  useEffect(() => () => ctrl.current?.abort(), []);

  const start = async (instr: string) => {
    lastInstr.current = instr;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setLive('');
    setResult(null);
    setError(null);
    try {
      const t = await rewriteSelection({ ...target, instruction: instr, onDelta: setLive, signal: c.signal });
      if (!c.signal.aborted) setResult(t);
    } catch (e) {
      if (!c.signal.aborted) setError(errText(e));
    } finally {
      if (!c.signal.aborted) setRunning(false);
    }
  };

  const words = countWords(target.selected);
  return (
    <Sheet open onClose={onClose} title="Tulis ulang">
      <div className="rewrite-original">
        <small>Bagian terpilih · {words} kata</small>
        <div className="clamp3">{target.selected}</div>
      </div>
      {result === null && !running && (
        <>
          <SheetItem icon={<IconSparkle />} label="Perhalus" hint="Kalimat lebih enak dibaca, makna sama" onClick={() => void start(REWRITE_PRESETS.polish)} />
          <SheetItem icon={<IconSparkle />} label="Perpanjang" hint="Tambah detail, suasana, dialog" onClick={() => void start(REWRITE_PRESETS.longer)} />
          <SheetItem icon={<IconSparkle />} label="Persingkat" hint="Kira-kira setengahnya" onClick={() => void start(REWRITE_PRESETS.shorter)} />
          <div className="form-pad">
            <textarea
              className="input"
              rows={2}
              placeholder="Atau tulis arahan sendiri, mis. buat Rika lebih marah"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>
          <div className="row-buttons pad">
            <button className="btn btn-primary" disabled={!instruction.trim()} onClick={() => void start(instruction.trim())}>
              Tulis ulang
            </button>
          </div>
        </>
      )}
      {error && <p className="note pad err">Gagal: {error}</p>}
      {(running || result !== null) && (
        <div className="assist-live">
          <MarkdownView text={result ?? live} />
          {running && (
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      )}
      {(result !== null || error) && (
        <div className="row-buttons pad">
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn" onClick={() => void start(lastInstr.current)}>
            <IconRetry size={16} /> Coba lagi
          </button>
          {result !== null && (
            <button className="btn btn-primary" disabled={!result.trim()} onClick={() => onReplace(result)}>
              Ganti
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
