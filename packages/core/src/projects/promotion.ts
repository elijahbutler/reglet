import { createHash } from 'node:crypto';

export interface TextMergeHunk {
  id: string;
  baseStart: number;
  baseEnd: number;
  incomingStart: number;
  incomingEnd: number;
  baseLines: string[];
  incomingLines: string[];
}

interface LinePair {
  base?: string;
  incoming?: string;
}

/** Produces stable, line-oriented replacement hunks for selective promotion. */
export function compareTextLines(base: string, incoming: string): TextMergeHunk[] {
  if (base === incoming) return [];
  const baseLines = base.split('\n');
  const incomingLines = incoming.split('\n');
  const pairs =
    baseLines.length * incomingLines.length <= 1_000_000
      ? alignWithLcs(baseLines, incomingLines)
      : alignLargeText(baseLines, incomingLines);
  const hunks: TextMergeHunk[] = [];
  let baseLine = 0;
  let incomingLine = 0;
  let pending: Omit<TextMergeHunk, 'id'> | undefined;

  const flush = () => {
    if (pending === undefined) return;
    const identity = JSON.stringify(pending);
    hunks.push({
      ...pending,
      id: createHash('sha256').update(identity).digest('hex').slice(0, 16),
    });
    pending = undefined;
  };

  for (const pair of pairs) {
    if (pair.base !== undefined && pair.base === pair.incoming) {
      flush();
      baseLine += 1;
      incomingLine += 1;
      continue;
    }
    pending ??= {
      baseStart: baseLine,
      baseEnd: baseLine,
      incomingStart: incomingLine,
      incomingEnd: incomingLine,
      baseLines: [],
      incomingLines: [],
    };
    if (pair.base !== undefined) {
      pending.baseLines.push(pair.base);
      baseLine += 1;
      pending.baseEnd = baseLine;
    }
    if (pair.incoming !== undefined) {
      pending.incomingLines.push(pair.incoming);
      incomingLine += 1;
      pending.incomingEnd = incomingLine;
    }
  }
  flush();
  return hunks;
}

export function mergeSelectedTextHunks(
  base: string,
  incoming: string,
  selectedHunkIds?: string[],
): string {
  const hunks = compareTextLines(base, incoming);
  const selected = new Set(selectedHunkIds ?? hunks.map((hunk) => hunk.id));
  const baseLines = base.split('\n');
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    output.push(...baseLines.slice(cursor, hunk.baseStart));
    output.push(
      ...(selected.has(hunk.id) ? hunk.incomingLines : hunk.baseLines),
    );
    cursor = hunk.baseEnd;
  }
  output.push(...baseLines.slice(cursor));
  return output.join('\n');
}

function alignWithLcs(base: string[], incoming: string[]): LinePair[] {
  const matrix = Array.from({ length: base.length + 1 }, () =>
    new Uint32Array(incoming.length + 1),
  );
  for (let left = base.length - 1; left >= 0; left -= 1) {
    const row = matrix[left];
    const next = matrix[left + 1];
    if (row === undefined || next === undefined) continue;
    for (let right = incoming.length - 1; right >= 0; right -= 1) {
      row[right] =
        base[left] === incoming[right]
          ? (next[right + 1] ?? 0) + 1
          : Math.max(next[right] ?? 0, row[right + 1] ?? 0);
    }
  }

  const result: LinePair[] = [];
  let left = 0;
  let right = 0;
  while (left < base.length || right < incoming.length) {
    if (left < base.length && right < incoming.length && base[left] === incoming[right]) {
      result.push({ base: base[left], incoming: incoming[right] });
      left += 1;
      right += 1;
    } else if (
      right < incoming.length &&
      (left >= base.length ||
        (matrix[left]?.[right + 1] ?? 0) >=
          (matrix[left + 1]?.[right] ?? 0))
    ) {
      result.push({ incoming: incoming[right] });
      right += 1;
    } else {
      result.push({ base: base[left] });
      left += 1;
    }
  }
  return result;
}

function alignLargeText(base: string[], incoming: string[]): LinePair[] {
  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < incoming.length &&
    base[prefix] === incoming[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < incoming.length - prefix &&
    base[base.length - 1 - suffix] === incoming[incoming.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return [
    ...base.slice(0, prefix).map((line) => ({ base: line, incoming: line })),
    ...base
      .slice(prefix, base.length - suffix)
      .map((line) => ({ base: line })),
    ...incoming
      .slice(prefix, incoming.length - suffix)
      .map((line) => ({ incoming: line })),
    ...base
      .slice(base.length - suffix)
      .map((line) => ({ base: line, incoming: line })),
  ];
}
