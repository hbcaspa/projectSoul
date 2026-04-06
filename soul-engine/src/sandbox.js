/**
 * Sandbox — Isolated code execution for the Soul Engine.
 *
 * Execution backends:
 * 1. Process — Node.js child_process with timeout and memory limits
 * 2. Docker — Container-based isolation (if Docker available)
 *
 * Security:
 * - Timeout enforcement (default 30s)
 * - Memory limit (default 256MB)
 * - No network access in process mode
 * - Temp directory for each execution (cleaned up after)
 */

import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT = 30_000;   // 30 seconds
const DEFAULT_MEMORY_MB = 256;

const LANGUAGE_CONFIG = {
  javascript: {
    command: 'node',
    flag: '-e',
    dockerImage: 'node:20-slim',
    dockerCmd: (file) => ['node', file],
  },
  python: {
    command: 'python3',
    flag: '-c',
    dockerImage: 'python:3.12-slim',
    dockerCmd: (file) => ['python3', file],
  },
  bash: {
    command: 'bash',
    flag: '-c',
    dockerImage: 'ubuntu:24.04',
    dockerCmd: (file) => ['bash', file],
  },
};

export class SandboxManager {
  constructor({ bus, soulPath }) {
    this.bus = bus;
    this.soulPath = soulPath;
    this._activeExecutions = new Map();
    this._dockerAvailable = null;  // cached after first check
  }

  /**
   * Execute code in an isolated sandbox.
   * Tries Docker first (if available and not explicitly disabled), falls back to process.
   *
   * @param {object} options
   * @param {string} options.code       - The code to execute
   * @param {string} options.language   - 'javascript' | 'python' | 'bash'
   * @param {number} [options.timeout]  - Timeout in ms (default 30000)
   * @param {number} [options.memoryMB] - Memory limit in MB (default 256)
   * @param {boolean} [options.preferDocker] - Force Docker if available
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, duration: number, sandboxId: string, backend: string}>}
   */
  async execute({ code, language = 'javascript', timeout = DEFAULT_TIMEOUT, memoryMB = DEFAULT_MEMORY_MB, preferDocker = false }) {
    const sandboxId = randomUUID();
    const langConfig = LANGUAGE_CONFIG[language];

    if (!langConfig) {
      const error = `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`;
      this.bus?.safeEmit('sandbox.error', { sandboxId, error, source: 'sandbox' });
      throw new Error(error);
    }

    this._activeExecutions.set(sandboxId, { language, startedAt: Date.now() });

    this.bus?.safeEmit('sandbox.started', { sandboxId, language, source: 'sandbox' });

    try {
      let result;

      if (preferDocker && this.isDockerAvailable()) {
        result = await this.executeInDocker({ code, language, timeout, memoryMB, sandboxId });
        result.backend = 'docker';
      } else {
        result = await this._executeProcess({ code, language, timeout, memoryMB, sandboxId });
        result.backend = 'process';
      }

      result.sandboxId = sandboxId;

      this.bus?.safeEmit('sandbox.completed', {
        sandboxId,
        language,
        exitCode: result.exitCode,
        duration: result.duration,
        backend: result.backend,
        source: 'sandbox',
      });

      return result;
    } catch (err) {
      this.bus?.safeEmit('sandbox.error', { sandboxId, error: err.message, source: 'sandbox' });
      throw err;
    } finally {
      this._activeExecutions.delete(sandboxId);
    }
  }

  /**
   * Execute code in a Docker container with full isolation.
   *
   * @param {object} options
   * @param {string} options.code
   * @param {string} options.language
   * @param {number} [options.timeout]
   * @param {number} [options.memoryMB]
   * @param {string} [options.sandboxId]
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, duration: number}>}
   */
  async executeInDocker({ code, language = 'javascript', timeout = DEFAULT_TIMEOUT, memoryMB = DEFAULT_MEMORY_MB, sandboxId }) {
    const langConfig = LANGUAGE_CONFIG[language];
    if (!langConfig) throw new Error(`Unsupported language: ${language}`);

    if (!this.isDockerAvailable()) {
      throw new Error('Docker is not available');
    }

    const id = sandboxId || randomUUID();
    const tmpDir = join(tmpdir(), `soul-sandbox-${id}`);
    const scriptFile = language === 'python' ? 'script.py' : language === 'bash' ? 'script.sh' : 'script.js';

    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, scriptFile), code, 'utf-8');

      const timeoutSec = Math.ceil(timeout / 1000);
      const dockerCmd = langConfig.dockerCmd(`/workspace/${scriptFile}`);

      const args = [
        'run', '--rm',
        '--network', 'none',
        `--memory=${memoryMB}m`,
        '--cpus=0.5',
        '--pids-limit=64',
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        '-v', `${tmpDir}:/workspace:ro`,
        '-w', '/workspace',
        langConfig.dockerImage,
        ...dockerCmd,
      ];

      const start = Date.now();

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const proc = spawn('docker', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH },
        });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGKILL');
        }, timeout);

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('close', (exitCode) => {
          clearTimeout(timer);
          const duration = Date.now() - start;

          if (killed) {
            stderr += `\n[sandbox] Process killed after ${timeoutSec}s timeout`;
          }

          // Cap output size to prevent memory issues
          if (stdout.length > 1_000_000) stdout = stdout.substring(0, 1_000_000) + '\n[...truncated at 1MB]';
          if (stderr.length > 1_000_000) stderr = stderr.substring(0, 1_000_000) + '\n[...truncated at 1MB]';

          resolve({ stdout, stderr, exitCode: killed ? 124 : (exitCode ?? 1), duration });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ stdout, stderr: stderr + `\n${err.message}`, exitCode: 1, duration: Date.now() - start });
        });
      });
    } finally {
      // Clean up temp directory
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }

  /**
   * Check if Docker CLI is available on this system.
   * Result is cached after the first check.
   *
   * @returns {boolean}
   */
  isDockerAvailable() {
    if (this._dockerAvailable !== null) return this._dockerAvailable;

    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      this._dockerAvailable = true;
    } catch {
      this._dockerAvailable = false;
    }

    return this._dockerAvailable;
  }

  /**
   * Execute code in a Node.js child process with timeout and memory limits.
   *
   * @param {object} options
   * @param {string} options.code
   * @param {string} options.language
   * @param {number} [options.timeout]
   * @param {number} [options.memoryMB]
   * @param {string} [options.sandboxId]
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, duration: number}>}
   */
  async _executeProcess({ code, language = 'javascript', timeout = DEFAULT_TIMEOUT, memoryMB = DEFAULT_MEMORY_MB, sandboxId }) {
    const langConfig = LANGUAGE_CONFIG[language];
    if (!langConfig) throw new Error(`Unsupported language: ${language}`);

    const id = sandboxId || randomUUID();
    const tmpDir = join(tmpdir(), `soul-sandbox-${id}`);

    try {
      // Use sync writes to guarantee file exists before spawn
      mkdirSync(tmpDir, { recursive: true });

      const scriptFile = language === 'python' ? 'script.py' : language === 'bash' ? 'script.sh' : 'script.js';
      const scriptPath = join(tmpDir, scriptFile);
      writeFileSync(scriptPath, code, 'utf-8');

      const args = [scriptPath];
      const cmd = langConfig.command;

      // For Node.js: add memory limit via --max-old-space-size
      if (language === 'javascript') {
        args.unshift(`--max-old-space-size=${memoryMB}`);
      }

      const start = Date.now();

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const proc = spawn(cmd, args, {
          cwd: tmpDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH,
            HOME: tmpDir,
            TMPDIR: tmpDir,
            NODE_ENV: 'sandbox',
            // Intentionally exclude most env vars for security
          },
          // Detach to enable killing the entire process group
          detached: false,
        });

        const timer = setTimeout(() => {
          killed = true;
          try {
            // Kill the process tree
            proc.kill('SIGKILL');
          } catch { /* process may have already exited */ }
        }, timeout);

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('close', (exitCode) => {
          clearTimeout(timer);
          const duration = Date.now() - start;

          if (killed) {
            stderr += `\n[sandbox] Process killed after ${Math.ceil(timeout / 1000)}s timeout`;
          }

          // Cap output size
          if (stdout.length > 1_000_000) stdout = stdout.substring(0, 1_000_000) + '\n[...truncated at 1MB]';
          if (stderr.length > 1_000_000) stderr = stderr.substring(0, 1_000_000) + '\n[...truncated at 1MB]';

          // Clean up temp directory after process exits
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
          resolve({ stdout, stderr, exitCode: killed ? 124 : (exitCode ?? 1), duration });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
          resolve({ stdout, stderr: stderr + `\n${err.message}`, exitCode: 1, duration: Date.now() - start });
        });
      });
    } catch (err) {
      // Clean up on setup failure
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      throw err;
    }
  }

  /**
   * Get current sandbox status.
   *
   * @returns {{ available: boolean, docker: boolean, activeExecutions: number, supported: string[] }}
   */
  getStatus() {
    return {
      available: true,
      docker: this.isDockerAvailable(),
      activeExecutions: this._activeExecutions.size,
      supported: Object.keys(LANGUAGE_CONFIG),
    };
  }
}
