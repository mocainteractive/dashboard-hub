import { Fragment, type ReactNode } from 'react';

/** Rendering minimo e sicuro del testo dell'assistente (niente HTML grezzo). */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc pl-5 space-y-1">
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push(<p key={blocks.length} className="font-bold uppercase text-xs tracking-wide text-moca-black pt-1">{heading[1].replace(/\*\*/g, '')}</p>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed text-moca-text">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
