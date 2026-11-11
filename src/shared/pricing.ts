import type { AiUsage } from './types';

/**
 * Prezzi di listino Anthropic (USD per milione di token, novembre 2026).
 * Scrittura in cache (5 minuti) = 1,25 volte l'input; lettura dalla cache
 * come da listino. Stima: la fattura reale è nella Console Anthropic.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: { match: RegExp; price: Price }[] = [
  { match: /opus-5-5/, price: { input: 4, output: 20, cacheRead: 0.2 } },
  { match: /opus-(5|4)/, price: { input: 5, output: 25, cacheRead: 0.5 } },
  { match: /sonnet-5-5/, price: { input: 2, output: 10, cacheRead: 0.1 } },
  { match: /sonnet/, price: { input: 2, output: 10, cacheRead: 0.2 } },
  { match: /haiku-5-5/, price: { input: 0.1, output: 0.5, cacheRead: 0.01 } },
  { match: /haiku/, price: { input: 1, output: 5, cacheRead: 0.1 } },
  { match: /fable-5-2|mythos-5-2/, price: { input: 8, output: 40, cacheRead: 0.2 } },
  { match: /fable|mythos/, price: { input: 10, output: 50, cacheRead: 1 } },
];

const DEFAULT: Price = { input: 4, output: 20, cacheRead: 0.2 };

export function priceOf(model: string): Price {
  return PRICES.find((p) => p.match.test(model))?.price ?? DEFAULT;
}

/** Costo stimato in dollari di un consumo di token. */
export function costUsd(u: Pick<AiUsage, 'model' | 'input' | 'output' | 'cacheRead' | 'cacheWrite'>): number {
  const p = priceOf(u.model);
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}

export function emptyUsage(model: string): AiUsage {
  return { model, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
}

export function addUsage(a: AiUsage, b: Omit<AiUsage, 'steps' | 'costUsd'>): AiUsage {
  const next = {
    model: b.model || a.model,
    steps: a.steps + 1,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: 0,
  };
  next.costUsd = a.costUsd + costUsd(b);
  return next;
}

/** "0,042 $" in formato italiano. */
export function formatUsd(v: number): string {
  return `${v.toLocaleString('it-IT', { minimumFractionDigits: v < 0.1 ? 3 : 2, maximumFractionDigits: v < 0.1 ? 3 : 2 })} $`;
}
