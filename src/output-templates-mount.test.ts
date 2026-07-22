import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { OUTPUT_TEMPLATES_DIR } from './config.js';

describe('output-templates mount', () => {
  it('exposes OUTPUT_TEMPLATES_DIR on the host', () => {
    expect(fs.existsSync(OUTPUT_TEMPLATES_DIR)).toBe(true);
    expect(fs.statSync(OUTPUT_TEMPLATES_DIR).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(OUTPUT_TEMPLATES_DIR, 'morning-paper.md'))).toBe(true);
  });

  it('wires the /app/output-templates mount in container-runner.ts', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'container-runner.ts'), 'utf-8');
    expect(src).toContain('OUTPUT_TEMPLATES_DIR');
    expect(src).toContain("'/app/output-templates'");
    expect(src).toContain('readonly: true');
  });

  it('mounts morning-paper.md read-only inside a container', () => {
    // Skip if Docker is not reachable.
    try {
      execSync('docker info', { stdio: 'pipe' });
    } catch {
      return;
    }

    const expected = fs.readFileSync(path.join(OUTPUT_TEMPLATES_DIR, 'morning-paper.md'), 'utf-8');
    const output = execSync(
      `docker run --rm -v "${OUTPUT_TEMPLATES_DIR}:/app/output-templates:ro" alpine cat /app/output-templates/morning-paper.md`,
      { encoding: 'utf-8' },
    );
    expect(output.trim()).toBe(expected.trim());
  });
});
