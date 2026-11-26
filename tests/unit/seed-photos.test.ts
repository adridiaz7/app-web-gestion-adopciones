import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copySeedPhotos, SEED_UPLOADS_URL } from "../../scripts/db-reset.js";

const PHOTOS_DIR = "db/seed-photos";

/** Every file under a folder, as paths relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll("\\", "/"))
    .sort();
}

function makeSource(): string {
  const source = mkdtempSync(join(tmpdir(), "lagun-seed-src-"));
  mkdirSync(join(source, "logos"));
  mkdirSync(join(source, "mascotas", "perro-rex"), { recursive: true });
  writeFileSync(join(source, "CREDITOS.md"), "# Créditos");
  writeFileSync(join(source, "logos", "rex.png"), "logo");
  writeFileSync(join(source, "mascotas", "perro-rex", "1.jpg"), "foto 1");
  writeFileSync(join(source, "mascotas", "perro-rex", "2.jpg"), "foto 2");
  return source;
}

describe("T-46: demo photos of the seed", () => {
  it("T-46: copies the photos and logos to uploads/seed keeping their folders, without CREDITOS.md", () => {
    const uploads = mkdtempSync(join(tmpdir(), "lagun-seed-up-"));
    copySeedPhotos(makeSource(), uploads);

    expect(filesUnder(join(uploads, "seed"))).toEqual(["logos/rex.png", "mascotas/perro-rex/1.jpg", "mascotas/perro-rex/2.jpg"]);
    expect(readFileSync(join(uploads, "seed", "mascotas", "perro-rex", "2.jpg"), "utf8")).toBe("foto 2");
  });

  it("T-46: a new reset replaces the previous copy and leaves the user's uploads alone", () => {
    const uploads = mkdtempSync(join(tmpdir(), "lagun-seed-up-"));
    mkdirSync(join(uploads, "seed", "mascotas", "gato-viejo"), { recursive: true });
    writeFileSync(join(uploads, "seed", "mascotas", "gato-viejo", "1.jpg"), "old");
    writeFileSync(join(uploads, "subida.jpg"), "user");

    copySeedPhotos(makeSource(), uploads);

    expect(existsSync(join(uploads, "seed", "mascotas", "gato-viejo"))).toBe(false);
    expect(existsSync(join(uploads, "subida.jpg"))).toBe(true);
  });

  it("T-46: db/seed.sql uses every demo photo and logo, and only files that exist", () => {
    const seed = readFileSync("db/seed.sql", "utf8");
    const used = [...seed.matchAll(/'\/uploads\/seed\/([^']+)'/g)].map((m) => m[1] ?? "").sort();
    const available = filesUnder(PHOTOS_DIR).filter((file) => !file.endsWith(".md"));

    expect(SEED_UPLOADS_URL).toBe("/uploads/seed/");
    expect(used).toEqual(available);
  });

  it("T-46, RN-51: each pet's photos keep the order of their file names, 1 being the main one", () => {
    const seed = readFileSync("db/seed.sql", "utf8");
    const rows = [...seed.matchAll(/'\/uploads\/seed\/mascotas\/([^/']+)\/(\d+)\.jpg',\s*(\d+)\)/g)];

    expect(rows.length).toBe(filesUnder(join(PHOTOS_DIR, "mascotas")).length);
    for (const [, , file, position] of rows) expect(position).toBe(file);
  });
});
