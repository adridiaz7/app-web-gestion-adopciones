/**
 * Test lock — guarantees that tests of finished features are never modified.
 *
 * When a feature is finished (all its tests green), its test files are "locked":
 * their SHA-256 hash is stored in tests/locked-tests.json. From then on, `check`
 * fails if any locked test has been modified or deleted.
 *
 * Changing a locked test is only allowed with the explicit approval of the project
 * owner, and it must be recorded with `relock` / `unlock --approved "<reason>"`,
 * which leaves a trace in the manifest history.
 *
 * Usage (Node 24 runs this TypeScript file directly, no build step needed):
 *   node scripts/test-lock.ts check
 *   node scripts/test-lock.ts lock --feature "<feature>" <file|dir>...
 *   node scripts/test-lock.ts relock --approved "<reason>" <file>...
 *   node scripts/test-lock.ts unlock --approved "<reason>" <file>...
 *   node scripts/test-lock.ts list
 *
 * Claude Code hooks (configured in .claude/settings.json, they read JSON on stdin):
 *   hook-pre   PreToolUse  — asks before editing a locked test, denies hand edits of the manifest
 *   hook-post  PostToolUse — after a shell command, reports any locked test that changed
 *   hook-stop  Stop        — Claude cannot end its turn with a locked test modified
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface LockedTest {
  feature: string;
  sha256: string;
  lockedAt: string;
}

interface HistoryEntry {
  date: string;
  action: "relock" | "unlock";
  file: string;
  reason: string;
}

interface Manifest {
  files: Record<string, LockedTest>;
  history: HistoryEntry[];
}

interface ParsedArgs {
  command: string | undefined;
  feature: string | undefined;
  approved: string | undefined;
  paths: string[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "tests/locked-tests.json";
const MANIFEST_PATH = join(ROOT, MANIFEST_REL);
const TEST_FILE_PATTERN = /\.(test|spec)\.ts$/;
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist"]);

class LockError extends Error {}

function toRepoPath(inputPath: string): string {
  const absolute = resolve(process.cwd(), inputPath);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith("..") || resolve(ROOT, rel) !== absolute) {
    throw new LockError(`La ruta está fuera del repositorio: ${inputPath}`);
  }
  return rel.split(sep).join("/");
}

/** Line endings are normalised so the hash is the same on Windows (CRLF) and Unix (LF). */
function hashContent(content: string): string {
  const normalised = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

function hashFile(repoPath: string): string {
  return hashContent(readFileSync(join(ROOT, repoPath), "utf8"));
}

function emptyManifest(): Manifest {
  return { files: {}, history: [] };
}

function parseManifest(raw: string, source: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new LockError(`${source} no es un JSON válido.`);
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !("files" in data) ||
    !("history" in data) ||
    typeof data.files !== "object" ||
    data.files === null ||
    !Array.isArray(data.history)
  ) {
    throw new LockError(`${source} no tiene el formato esperado ({ files, history }).`);
  }
  return data as Manifest;
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    return emptyManifest();
  }
  return parseManifest(readFileSync(MANIFEST_PATH, "utf8"), MANIFEST_REL);
}

function saveManifest(manifest: Manifest): void {
  const sortedFiles: Record<string, LockedTest> = {};
  for (const key of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[key];
    if (entry !== undefined) {
      sortedFiles[key] = entry;
    }
  }
  const output: Manifest = { files: sortedFiles, history: manifest.history };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

/** Manifest as it is in the last commit, or null if there is no git history for it. */
function loadCommittedManifest(): Manifest | null {
  try {
    const raw = execFileSync("git", ["show", `HEAD:${MANIFEST_REL}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseManifest(raw, `${MANIFEST_REL} (HEAD)`);
  } catch (error) {
    if (error instanceof LockError) {
      throw error;
    }
    return null;
  }
}

function collectTestFiles(inputPaths: string[]): string[] {
  const found = new Set<string>();
  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(join(absoluteDir, entry.name));
        }
      } else if (TEST_FILE_PATTERN.test(entry.name)) {
        found.add(toRepoPath(join(absoluteDir, entry.name)));
      }
    }
  };

  for (const inputPath of inputPaths) {
    const absolute = resolve(process.cwd(), inputPath);
    if (!existsSync(absolute)) {
      throw new LockError(`No existe: ${inputPath}`);
    }
    if (statSync(absolute).isDirectory()) {
      walk(absolute);
    } else if (TEST_FILE_PATTERN.test(absolute)) {
      found.add(toRepoPath(absolute));
    } else {
      throw new LockError(`No es un archivo de test (*.test.ts o *.spec.ts): ${inputPath}`);
    }
  }
  if (found.size === 0) {
    throw new LockError("No se ha encontrado ningún archivo de test en las rutas indicadas.");
  }
  return [...found].sort();
}

function requireValue(value: string | undefined, flag: string, hint: string): string {
  if (value === undefined || value.trim() === "") {
    throw new LockError(`Falta ${flag}. ${hint}`);
  }
  return value.trim();
}

function requirePaths(paths: string[]): void {
  if (paths.length === 0) {
    throw new LockError("Indica al menos un archivo o carpeta de tests.");
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

function collectViolations(): string[] {
  const manifest = loadManifest();
  const violations: string[] = [];

  for (const [file, entry] of Object.entries(manifest.files)) {
    if (!existsSync(join(ROOT, file))) {
      violations.push(`ELIMINADO   ${file}  (funcionalidad: ${entry.feature})`);
    } else if (hashFile(file) !== entry.sha256) {
      violations.push(`MODIFICADO  ${file}  (funcionalidad: ${entry.feature})`);
    }
  }

  // The manifest itself must not be altered to hide a change: every locked entry from
  // the last commit that disappears or changes hash needs a new approved history entry.
  const committed = loadCommittedManifest();
  if (committed !== null) {
    const committedHistory = JSON.stringify(committed.history);
    const currentPrefix = JSON.stringify(manifest.history.slice(0, committed.history.length));
    if (committedHistory !== currentPrefix) {
      violations.push(`HISTORIAL   ${MANIFEST_REL}: se han editado o borrado entradas del historial de aprobaciones`);
    }
    const newHistory = manifest.history.slice(committed.history.length);
    for (const [file, entry] of Object.entries(committed.files)) {
      const current = manifest.files[file];
      if (current !== undefined && current.sha256 === entry.sha256) {
        continue;
      }
      const approved = newHistory.some((h) => h.file === file);
      if (!approved) {
        violations.push(`CANDADO     ${file}: se ha cambiado o quitado del manifiesto sin una aprobación registrada`);
      }
    }
  }

  return violations;
}

const VIOLATION_HELP =
  "Los tests bloqueados no se pueden cambiar. Deshaz el cambio o, solo con la aprobación" +
  "\nexplícita del responsable del proyecto, regístralo con:" +
  '\n  node scripts/test-lock.ts relock --approved "<motivo y quién lo aprobó>" <archivo>' +
  '\n  node scripts/test-lock.ts unlock --approved "<motivo y quién lo aprobó>" <archivo>';

function formatViolations(violations: string[]): string {
  return [
    "✖ Se han modificado tests de funcionalidades ya terminadas:",
    "",
    ...violations.map((v) => `  ${v}`),
    "",
    VIOLATION_HELP,
  ].join("\n");
}

function check(): number {
  const violations = collectViolations();
  if (violations.length > 0) {
    console.error(formatViolations(violations));
    return 1;
  }
  const total = Object.keys(loadManifest().files).length;
  console.log(`✔ ${total} test(s) bloqueado(s) sin cambios.`);
  return 0;
}

function lock(feature: string, inputPaths: string[]): number {
  const manifest = loadManifest();
  const now = new Date().toISOString();
  let added = 0;

  for (const file of collectTestFiles(inputPaths)) {
    const hash = hashFile(file);
    const existing = manifest.files[file];
    if (existing !== undefined) {
      if (existing.sha256 !== hash) {
        throw new LockError(
          `${file} ya está bloqueado (funcionalidad: ${existing.feature}) y ha cambiado. ` +
            "No se puede volver a bloquear sin aprobación: usa relock --approved.",
        );
      }
      console.log(`  = ${file} (ya estaba bloqueado)`);
      continue;
    }
    manifest.files[file] = { feature, sha256: hash, lockedAt: now };
    console.log(`  + ${file}`);
    added += 1;
  }

  saveManifest(manifest);
  console.log(`✔ ${added} test(s) bloqueado(s) para la funcionalidad "${feature}".`);
  return 0;
}

function relock(reason: string, inputPaths: string[]): number {
  const manifest = loadManifest();
  const now = new Date().toISOString();

  for (const file of collectTestFiles(inputPaths)) {
    const existing = manifest.files[file];
    if (existing === undefined) {
      throw new LockError(`${file} no está bloqueado: usa lock en lugar de relock.`);
    }
    manifest.files[file] = { ...existing, sha256: hashFile(file), lockedAt: now };
    manifest.history.push({ date: now, action: "relock", file, reason });
    console.log(`  ~ ${file}`);
  }

  saveManifest(manifest);
  console.log("✔ Cambio aprobado registrado en el historial.");
  return 0;
}

function unlock(reason: string, inputPaths: string[]): number {
  const manifest = loadManifest();
  const now = new Date().toISOString();

  // The file may already be deleted, so paths are not checked on disk.
  for (const inputPath of inputPaths) {
    const file = toRepoPath(inputPath);
    if (manifest.files[file] === undefined) {
      throw new LockError(`${file} no está bloqueado.`);
    }
    delete manifest.files[file];
    manifest.history.push({ date: now, action: "unlock", file, reason });
    console.log(`  - ${file}`);
  }

  saveManifest(manifest);
  console.log("✔ Desbloqueo aprobado registrado en el historial.");
  return 0;
}

function list(): number {
  const manifest = loadManifest();
  const byFeature = new Map<string, string[]>();
  for (const [file, entry] of Object.entries(manifest.files)) {
    const files = byFeature.get(entry.feature) ?? [];
    files.push(file);
    byFeature.set(entry.feature, files);
  }
  if (byFeature.size === 0) {
    console.log("No hay tests bloqueados.");
    return 0;
  }
  for (const [feature, files] of [...byFeature.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${feature}`);
    for (const file of files.sort()) {
      console.log(`  ${file}`);
    }
  }
  if (manifest.history.length > 0) {
    console.log(`\nCambios aprobados: ${manifest.history.length} (ver "history" en ${MANIFEST_REL}).`);
  }
  return 0;
}

// ── Claude Code hooks ───────────────────────────────────────────────────────
// Claude Code sends a JSON payload on stdin and reads a JSON decision from stdout.
// The hooks always exit 0: the decision travels in the JSON, never in the exit code.

interface HookPayload {
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; command?: string };
  stop_hook_active?: boolean;
}

function readHookPayload(): HookPayload {
  try {
    const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

function emit(output: object): number {
  console.log(JSON.stringify(output));
  return 0;
}

function preToolDecision(decision: "ask" | "deny", reason: string): number {
  return emit({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  });
}

/** Repo-relative path of a file Claude is about to write, or null if it is outside the repo. */
function repoPathOrNull(filePath: string): string | null {
  const absolute = resolve(process.cwd(), filePath);
  const rel = relative(ROOT, absolute);
  if (rel === "" || rel.startsWith("..") || resolve(ROOT, rel).toLowerCase() !== absolute.toLowerCase()) {
    return null;
  }
  return rel.split(sep).join("/");
}

const APPROVAL_COMMAND = /test-lock\.ts["']?\s+(relock|unlock)\b/;

/**
 * PreToolUse: before Claude edits a file or runs a command.
 * - Editing a locked test → ask the user (the change needs their explicit approval).
 * - Editing the manifest by hand → deny (it may only be changed through this script).
 * - Running relock/unlock → ask the user (registering an approval is their call).
 * - A shell command that touches the manifest directly → deny.
 */
function hookPre(): number {
  const payload = readHookPayload();
  const input = payload.tool_input ?? {};
  const manifest = loadManifest();

  const target = input.file_path ?? input.notebook_path;
  if (target !== undefined) {
    const file = repoPathOrNull(target);
    if (file === MANIFEST_REL) {
      return preToolDecision(
        "deny",
        `${MANIFEST_REL} solo se modifica con scripts/test-lock.ts (lock, relock, unlock), nunca a mano.`,
      );
    }
    const entry = file === null ? undefined : manifest.files[file];
    if (file !== null && entry !== undefined) {
      return preToolDecision(
        "ask",
        `${file} es un test BLOQUEADO (funcionalidad: ${entry.feature}). ` +
          "Solo se puede modificar con tu aprobación explícita. Si lo apruebas, después habrá que registrarlo con relock.",
      );
    }
    return 0;
  }

  const command = input.command;
  if (command !== undefined) {
    if (APPROVAL_COMMAND.test(command)) {
      return preToolDecision(
        "ask",
        "Este comando registra un cambio en un test bloqueado. Apruébalo solo si has dado el visto bueno a ese cambio.",
      );
    }
    if (command.includes("locked-tests.json") && !command.includes("test-lock.ts")) {
      return preToolDecision(
        "deny",
        `${MANIFEST_REL} solo se modifica con scripts/test-lock.ts (lock, relock, unlock), nunca a mano.`,
      );
    }
  }
  return 0;
}

/** PostToolUse on Bash: a shell command may have changed a locked test; tell Claude immediately. */
function hookPost(): number {
  readHookPayload();
  const violations = collectViolations();
  if (violations.length === 0) {
    return 0;
  }
  return emit({
    decision: "block",
    reason: `${formatViolations(violations)}\n\nRestaura los tests afectados antes de continuar.`,
  });
}

/** Stop: Claude cannot finish its turn while a locked test is modified without approval. */
function hookStop(): number {
  const payload = readHookPayload();
  const violations = collectViolations();
  if (violations.length === 0) {
    return 0;
  }
  if (payload.stop_hook_active === true) {
    // Already blocked once in this stop sequence: warn the user instead of looping.
    return emit({ systemMessage: formatViolations(violations) });
  }
  return emit({
    decision: "block",
    reason: `${formatViolations(violations)}\n\nNo termines el turno: restaura los tests o pide aprobación al usuario.`,
  });
}

// ── Entry point ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: argv[0], feature: undefined, approved: undefined, paths: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--feature") {
      parsed.feature = argv[i + 1];
      i += 1;
    } else if (arg === "--approved") {
      parsed.approved = argv[i + 1];
      i += 1;
    } else if (arg !== undefined) {
      parsed.paths.push(arg);
    }
  }
  return parsed;
}

function run(argv: string[]): number {
  const args = parseArgs(argv);
  switch (args.command) {
    case "check":
      return check();
    case "lock":
      requirePaths(args.paths);
      return lock(requireValue(args.feature, "--feature", 'Ejemplo: --feature "CU-23 Solicitar una visita"'), args.paths);
    case "relock":
      requirePaths(args.paths);
      return relock(requireValue(args.approved, "--approved", "Indica el motivo y quién lo aprobó."), args.paths);
    case "unlock":
      requirePaths(args.paths);
      return unlock(requireValue(args.approved, "--approved", "Indica el motivo y quién lo aprobó."), args.paths);
    case "list":
      return list();
    case "hook-pre":
      return hookPre();
    case "hook-post":
      return hookPost();
    case "hook-stop":
      return hookStop();
    default:
      console.error("Uso: node scripts/test-lock.ts <check | lock | relock | unlock | list | hook-pre | hook-post | hook-stop>");
      return 1;
  }
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof LockError) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
