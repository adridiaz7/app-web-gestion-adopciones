import { existsSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

/** Minimal file contents with the signature of each format. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(24, 3)]);

const photosUrl = (petId: number) => `/api/shelter/pets/${String(petId)}/photos`;

let shelter: CreatedUser;
let cookie: string;
let petId: number;

interface PhotoBody {
  id: number;
  url: string;
  position: number;
}

const upload = (pet: number, file: Buffer, name = "foto.png", as = cookie) =>
  request(createApp()).post(photosUrl(pet)).set("Cookie", as).attach("photo", file, name);

async function uploadOk(file = PNG): Promise<PhotoBody[]> {
  const res = await upload(petId, file);
  expect(res.status).toBe(201);
  return res.body.photos as PhotoBody[];
}

async function photoRows(pet: number): Promise<{ path: string; position: number }[]> {
  const { rows } = await getPool().query<{ path: string; position: number }>(
    `SELECT path, position FROM "Pet_photo" WHERE pet_id = $1 ORDER BY position`,
    [pet],
  );
  return rows;
}

const fileOf = (url: string) => join(getConfig().uploadsDir, url.replace(/^\/uploads\//, ""));

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
  petId = (await createPet({ shelterId: shelter.id })).id;
});

describe("T-13 CU-15, CU-16 POST /api/shelter/pets/:id/photos", () => {
  it("RN-52: stores the photo on disk with a random name and only its path in the database", async () => {
    const photos = await uploadOk();

    expect(photos).toEqual([{ id: expect.any(Number), url: expect.stringMatching(/^\/uploads\/[\w-]+\.png$/), position: 1 }]);
    const url = photos[0]?.url ?? "";
    expect(url).not.toContain("foto");
    expect(await photoRows(petId)).toEqual([{ path: url, position: 1 }]);
    expect(existsSync(fileOf(url))).toBe(true);
  });

  it("RN-52: the uploaded photo is served under /uploads", async () => {
    const [photo] = await uploadOk();

    const res = await request(createApp()).get(photo?.url ?? "");

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });

  it("RN-51: each new photo goes after the existing ones; the first is the main one", async () => {
    await uploadOk(PNG);
    await uploadOk(JPEG);
    const photos = await uploadOk(WEBP);

    expect(photos.map((p) => [p.position, p.url.split(".").pop()])).toEqual([
      [1, "png"],
      [2, "jpg"],
      [3, "webp"],
    ]);
  });

  it("RN-50, CU-15: rejects a seventh photo", async () => {
    for (let i = 0; i < 6; i++) await uploadOk();

    const res = await upload(petId, PNG);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Una mascota puede tener como máximo 6 fotos." });
    expect(await photoRows(petId)).toHaveLength(6);
  });

  it("CU-15: rejects a file that is not a JPEG, PNG or WebP image, whatever its extension", async () => {
    const res = await upload(petId, Buffer.from("esto no es una imagen, es texto"), "foto.png");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La foto tiene que ser una imagen JPEG, PNG o WebP." });
    expect(await photoRows(petId)).toEqual([]);
  });

  it("CU-15: rejects a photo larger than the maximum size", async () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(getConfig().maxPhotoSizeMb * 1024 * 1024)]);

    const res = await upload(petId, tooBig);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: `La foto no puede ocupar más de ${String(getConfig().maxPhotoSizeMb)} MB.` });
    expect(await photoRows(petId)).toEqual([]);
  });

  it("CU-15: rejects a request without a photo", async () => {
    const res = await request(createApp()).post(photosUrl(petId)).set("Cookie", cookie).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Elige una foto." });
  });

  it("CU-16: a shelter cannot add photos to another shelter's pet", async () => {
    const other = await createShelter();

    const res = await upload(petId, PNG, "foto.png", await sessionCookie(other.id));

    expect(res.status).toBe(404);
    expect(await photoRows(petId)).toEqual([]);
  });

  it("CU-16: only a shelter can manage photos", async () => {
    const adopter = await createAdopter();

    expect((await request(createApp()).post(photosUrl(petId)).attach("photo", PNG, "foto.png")).status).toBe(401);
    expect((await upload(petId, PNG, "foto.png", await sessionCookie(adopter.id))).status).toBe(403);
  });

  it("RN-208: records the photo change in the audit log", async () => {
    const [photo] = await uploadOk();

    const { rows } = await getPool().query(
      `SELECT action, actor_user_id, entity_type, entity_id, details FROM "Audit_log" ORDER BY id`,
    );
    expect(rows).toEqual([
      {
        action: "PET_PHOTOS_UPDATED",
        actor_user_id: shelter.id,
        entity_type: "Pet",
        entity_id: petId,
        details: { before: { photos: [] }, after: { photos: [photo?.url] } },
      },
    ]);
  });
});

describe("T-13 CU-16 GET /api/shelter/pets/:id/photos", () => {
  it("CU-16: lists the pet's photos in order", async () => {
    await uploadOk(PNG);
    await uploadOk(JPEG);

    const res = await request(createApp()).get(photosUrl(petId)).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect((res.body.photos as PhotoBody[]).map((p) => p.position)).toEqual([1, 2]);
  });

  it("RN-50: tells the screen the configured maximum of photos", async () => {
    const res = await request(createApp()).get(photosUrl(petId)).set("Cookie", cookie);

    expect(res.body).toEqual({ photos: [], maxPhotos: getConfig().rules.maxPhotosPerPet });
  });

  it("CU-16: answers 404 for another shelter's pet", async () => {
    const other = await createShelter();

    const res = await request(createApp()).get(photosUrl(petId)).set("Cookie", await sessionCookie(other.id));

    expect(res.status).toBe(404);
  });
});

describe("T-13 CU-16 DELETE /api/shelter/pets/:id/photos/:photoId", () => {
  it("CU-16, RN-51: deletes a photo, its file, and closes the gap in the order", async () => {
    await uploadOk(PNG);
    const [first, second, third] = await uploadOk(JPEG).then(() => uploadOk(WEBP));

    const res = await request(createApp())
      .delete(`${photosUrl(petId)}/${String(first?.id)}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([
      { id: second?.id, url: second?.url, position: 1 },
      { id: third?.id, url: third?.url, position: 2 },
    ]);
    expect(existsSync(fileOf(first?.url ?? ""))).toBe(false);
    expect(await photoRows(petId)).toHaveLength(2);
  });

  it("CU-16: answers 404 for a photo of another pet", async () => {
    const otherPet = await createPet({ shelterId: shelter.id });
    const [photo] = await uploadOk();

    const res = await request(createApp())
      .delete(`${photosUrl(otherPet.id)}/${String(photo?.id)}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(await photoRows(petId)).toHaveLength(1);
  });

  it("CU-16: a shelter cannot delete another shelter's photos", async () => {
    const [photo] = await uploadOk();
    const other = await createShelter();

    const res = await request(createApp())
      .delete(`${photosUrl(petId)}/${String(photo?.id)}`)
      .set("Cookie", await sessionCookie(other.id));

    expect(res.status).toBe(404);
    expect(await photoRows(petId)).toHaveLength(1);
  });
});

describe("T-13 CU-16 PUT /api/shelter/pets/:id/photos/order", () => {
  const reorder = (pet: number, photoIds: unknown, as = cookie) =>
    request(createApp()).put(`${photosUrl(pet)}/order`).set("Cookie", as).send({ photoIds });

  it("CU-16, RN-51: reorders the photos; the first one becomes the main photo", async () => {
    await uploadOk(PNG);
    await uploadOk(JPEG);
    const [a, b, c] = await uploadOk(WEBP);

    const res = await reorder(petId, [c?.id, a?.id, b?.id]);

    expect(res.status).toBe(200);
    expect((res.body.photos as PhotoBody[]).map((p) => [p.id, p.position])).toEqual([
      [c?.id, 1],
      [a?.id, 2],
      [b?.id, 3],
    ]);
    expect((await photoRows(petId)).map((r) => r.path)).toEqual([c?.url, a?.url, b?.url]);
  });

  it("CU-16: rejects an order that does not list exactly the pet's photos", async () => {
    await uploadOk(PNG);
    const [a, b] = await uploadOk(JPEG);

    for (const ids of [[a?.id], [a?.id, a?.id], [a?.id, b?.id, 999999]]) {
      const res = await reorder(petId, ids);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "El nuevo orden tiene que incluir todas las fotos de la mascota, una vez cada una." });
    }
    expect((await photoRows(petId)).map((r) => r.path)).toEqual([a?.url, b?.url]);
  });

  it("CU-16: rejects a malformed list", async () => {
    expect((await reorder(petId, "1,2")).status).toBe(400);
  });

  it("CU-16: a shelter cannot reorder another shelter's photos", async () => {
    const [a] = await uploadOk();
    const other = await createShelter();

    expect((await reorder(petId, [a?.id], await sessionCookie(other.id))).status).toBe(404);
  });
});
