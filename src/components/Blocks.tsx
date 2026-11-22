import type { JSONContent } from '@tiptap/react';
import { parseMarkdown } from '../lib/markdown';

function Inline({ nodes }: { nodes?: JSONContent[] }) {
  return (
    <>
      {nodes?.map((n, i) => {
        let el: React.ReactNode = n.text;
        if (n.marks?.some((m) => m.type === 'italic')) el = <em>{el}</em>;
        if (n.marks?.some((m) => m.type === 'bold')) el = <strong>{el}</strong>;
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

/** Tampilkan teks Markdown sederhana (pratinjau streaming dan jawaban diskusi). */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text, null);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === 'horizontalRule') return <hr key={i} />;
        if (b.type === 'heading')
          return (
            <h2 key={i}>
              <Inline nodes={b.content} />
            </h2>
          );
        return (
          <p key={i}>
            <Inline nodes={b.content} />
          </p>
        );
      })}
    </div>
  );
}
