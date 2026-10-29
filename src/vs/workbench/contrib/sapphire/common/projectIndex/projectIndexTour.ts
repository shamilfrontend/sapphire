/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  ProjectIndexEdgeRecord,
  ProjectIndexFileRecord,
  ProjectIndexLayer,
  ProjectIndexTour,
  ProjectIndexTourStep,
} from './projectIndexTypes.js';

const MAX_FILES_IN_PROMPT = 80;
const MAX_EDGES_IN_PROMPT = 60;
const MAX_TOUR_STEPS = 12;
const MAX_PATHS_PER_STEP = 5;
const MAX_SYMBOLS_PER_STEP = 8;

/** basedOn считается устаревшим, если counts уехали дальше этих порогов. */
export function isTourStale(
  tour: ProjectIndexTour | null,
  counts: { files: number; edges: number; purposeDone: number } | null | undefined,
): boolean {
  if (!tour || !counts || !tour.basedOn) {
    return false;
  }
  const { basedOn } = tour;
  const fileDelta = Math.abs(counts.files - (basedOn.files ?? 0));
  const edgeDelta = Math.abs(counts.edges - (basedOn.edges ?? 0));
  const purposeDelta = Math.abs(counts.purposeDone - (basedOn.purposeDone ?? 0));
  return fileDelta >= 25 || edgeDelta >= 40 || purposeDelta >= 30;
}

export function buildTourPromptInput(opts: {
  files: ProjectIndexFileRecord[];
  edges: ProjectIndexEdgeRecord[];
}): string {
  const layerCounts = new Map<ProjectIndexLayer, number>();
  for (const file of opts.files) {
    layerCounts.set(file.layer, (layerCounts.get(file.layer) ?? 0) + 1);
  }
  const layersLine = [...layerCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([layer, n]) => `${layer}:${n}`)
    .join(', ');

  const ranked = [...opts.files]
    .filter((f) => f.kind === 'code' || f.kind === 'other')
    .sort((a, b) => {
      const ap = a.purpose ? 1 : 0;
      const bp = b.purpose ? 1 : 0;
      if (bp !== ap) {
        return bp - ap;
      }
      return a.path.localeCompare(b.path);
    })
    .slice(0, MAX_FILES_IN_PROMPT);

  const fileLines = ranked.map((f) => {
    const purpose = (f.purpose ?? f.localRole).replace(/\s+/g, ' ').slice(0, 120);
    const tags = (f.tags ?? []).slice(0, 4).join('|');
    return `${f.path} [${f.layer}] ${purpose}${tags ? ` tags=${tags}` : ''}`;
  });

  const edgeLines = opts.edges
    .filter((e) => e.type === 'imports' || e.type === 'calls')
    .slice(0, MAX_EDGES_IN_PROMPT)
    .map((e) => {
      const from = e.fromSymbol ? `${e.fromPath}#${e.fromSymbol}` : e.fromPath;
      const to = e.toSymbol ? `${e.toPath}#${e.toSymbol}` : e.toPath;
      return `${from} -${e.type}-> ${to}`;
    });

  return `layers: ${layersLine || 'none'}
files (${fileLines.length}):
${fileLines.join('\n') || '(none)'}
edges (${edgeLines.length}):
${edgeLines.join('\n') || '(none)'}`;
}

export const PROJECT_INDEX_TOUR_SYSTEM_MESSAGE = `You write a short onboarding tour for a codebase from an index summary.
Reply with ONLY compact JSON:
{"steps":[{"order":1,"title":"...","description":"2-3 sentences","paths":["rel/path.ts"],"symbols":["OptionalSymbol"]}]}
Rules:
- 4 to 12 steps, dependency / learning order (entry points and core modules first, utilities last).
- Each step: 1-5 workspace-relative paths that appear in the files list. Prefer paths with purpose.
- symbols optional; only names that fit the paths.
- No markdown fences. Russian or English ok.`.trim();

export function parseTourLlmJson(
  fullText: string,
  knownPaths: Set<string>,
): ProjectIndexTourStep[] {
  const start = fullText.indexOf('{');
  if (start < 0) {
    throw new Error('No JSON in tour response');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < fullText.length; i++) {
    const ch = fullText[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error('No JSON in tour response');
  }
  const parsed = JSON.parse(fullText.slice(start, end + 1)) as {
    steps?: unknown;
  };
  if (!Array.isArray(parsed.steps)) {
    throw new Error('Tour JSON missing steps array');
  }

  const steps: ProjectIndexTourStep[] = [];
  for (const raw of parsed.steps) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const description = typeof obj.description === 'string' ? obj.description.trim() : '';
    if (!title || !description) {
      continue;
    }
    const pathsRaw = Array.isArray(obj.paths) ? obj.paths : [];
    const paths = pathsRaw
      .map((p) => (typeof p === 'string' ? p.trim().replace(/\\/g, '/') : ''))
      .filter((p) => p && knownPaths.has(p))
      .slice(0, MAX_PATHS_PER_STEP);
    if (paths.length === 0) {
      continue;
    }
    const symbolsRaw = Array.isArray(obj.symbols) ? obj.symbols : [];
    const symbols = symbolsRaw
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS_PER_STEP);
    steps.push({
      order: steps.length + 1,
      title: title.slice(0, 120),
      description: description.slice(0, 600),
      paths,
      ...(symbols.length ? { symbols } : {}),
    });
    if (steps.length >= MAX_TOUR_STEPS) {
      break;
    }
  }
  if (steps.length === 0) {
    throw new Error('Tour JSON produced no valid steps');
  }
  return steps;
}

export function tourStepAt(
  steps: readonly ProjectIndexTourStep[],
  order: number,
): ProjectIndexTourStep | null {
  return steps.find((step) => step.order === order) ?? null;
}

export function formatTourForAgent(tour: ProjectIndexTour | null): string {
  const steps = tour?.steps;
  if (!tour || !steps?.length) {
    return 'No onboarding tour yet. It is generated automatically after indexing when the tour is missing or stale. Call get_project_tour again after indexing finishes.';
  }
  const basedOn = tour.basedOn;
  const lines: string[] = [
    `# Project onboarding tour (${steps.length} steps)`,
    `Generated: ${new Date(tour.generatedAt).toISOString()}`,
    `Based on: files=${basedOn?.files ?? 0}, edges=${basedOn?.edges ?? 0}, purposeDone=${basedOn?.purposeDone ?? 0}`,
    '',
  ];
  for (const step of steps) {
    lines.push(`## ${step.order}. ${step.title}`);
    lines.push(step.description);
    lines.push(`Paths: ${step.paths.join(', ')}`);
    if (step.symbols?.length) {
      lines.push(`Symbols: ${step.symbols.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function buildTourRecord(
  steps: ProjectIndexTourStep[],
  basedOn: ProjectIndexTour['basedOn'],
): ProjectIndexTour {
  return {
    generatedAt: Date.now(),
    basedOn,
    steps,
  };
}
