/**
 * Mechanical guard for the determinism rules (CLAUDE.md, concept §8.2).
 *
 * These rules are the reason a replay stays bit-identical across engines, so
 * they are enforced by a test rather than by review attention. The guard scans
 * the source text of `src/sim/**` instead of its runtime behaviour: a forbidden
 * call is a defect even on a code path no test happens to reach.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_ROOT = 'src/sim';

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      // Test files are not shipped in the sim and legitimately call the host
      // Math library as a reference oracle — sim/math.test.ts compares against
      // Math.sin on purpose. Only production sim code is scanned.
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Comments legitimately name what they replace ("stands in for Math.sin"), so
 * they are blanked out before scanning. Blanking keeps the line count intact,
 * which keeps the reported line numbers honest.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (_match, prefix: string) => prefix);
}

const FORBIDDEN: { rule: string; pattern: RegExp }[] = [
  { rule: 'Math.random (rule 1)', pattern: /\bMath\s*\.\s*random\b/ },
  { rule: 'Date (rule 1)', pattern: /\bDate\s*\.\s*now\b|\bnew\s+Date\b/ },
  { rule: 'performance.now (rule 1)', pattern: /\bperformance\s*\.\s*now\b/ },
  { rule: 'timers (rule 1)', pattern: /\bset(?:Timeout|Interval)\b|\brequestAnimationFrame\b/ },
  {
    rule: 'transcendental Math (rule 2) — use sim/math.ts',
    pattern: /\bMath\s*\.\s*(?:sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|hypot|cbrt)\b/,
  },
  { rule: 'exponentiation operator (rule 2) — use sim/math.ts', pattern: /\*\*/ },
  { rule: 'UI import (rule 4)', pattern: /from\s+['"][^'"]*\bui\// },
];

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const file of collectTsFiles(SIM_ROOT)) {
    const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
    lines.forEach((text, index) => {
      for (const { rule, pattern } of FORBIDDEN) {
        if (pattern.test(text)) {
          violations.push({ file, line: index + 1, rule, text: text.trim() });
        }
      }
    });
  }
  return violations;
}

describe('determinism guard for src/sim', () => {
  it('has a sim directory to guard', () => {
    // Without this the scan below would pass vacuously on a typo in SIM_ROOT.
    expect(existsSync(SIM_ROOT)).toBe(true);
  });

  it('uses no wall clock, no Math.random, no engine-dependent transcendentals and no UI imports', () => {
    const report = scan().map((v) => `${v.file}:${v.line} — ${v.rule}\n    ${v.text}`);
    expect(report).toEqual([]);
  });
});
