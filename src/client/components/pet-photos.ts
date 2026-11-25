import type { PetPhotosResponse } from "../../shared/api.js";
import { ApiError } from "../api/client.js";
import { deletePetPhoto, listPetPhotos, reorderPetPhotos, uploadPetPhoto } from "../api/pets.js";
import { h } from "../dom.js";
import { notice } from "./notice.js";

/**
 * CU-15, CU-16: the photos of a pet: add, delete and reorder. The first one is the main
 * photo (RN-51). Every change answers with the new list, which is drawn again.
 */
export function petPhotosSection(petId: number): HTMLElement {
  const section = h("section", { class: "card pet-photos" });

  // RN-50: the maximum comes from the server's configuration, in every answer.
  const draw = ({ photos, maxPhotos }: PetPhotosResponse, message?: Node): void => {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
    const addButton = h(
      "button",
      { type: "button", class: "button button--secondary button--small", disabled: photos.length >= maxPhotos },
      "Añadir foto",
    );

    const run = async (action: () => Promise<PetPhotosResponse>): Promise<void> => {
      section.querySelectorAll("button").forEach((button) => (button.disabled = true));
      try {
        draw(await action());
      } catch (error) {
        draw({ photos, maxPhotos }, notice("error", error instanceof ApiError ? error.message : "No se ha podido guardar el cambio."));
      }
    };

    addButton.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void run(() => uploadPetPhoto(petId, file));
    });

    const move = (from: number, to: number): number[] => {
      const ids = photos.map((p) => p.id);
      const [moved] = ids.splice(from, 1);
      if (moved !== undefined) ids.splice(to, 0, moved);
      return ids;
    };

    const items = photos.map((photo, index) => {
      const makeMain = h("button", { type: "button", class: "button button--small", disabled: index === 0 }, "Principal");
      const left = h("button", { type: "button", class: "button button--small", disabled: index === 0, "aria-label": "Mover antes" }, "←");
      const right = h(
        "button",
        { type: "button", class: "button button--small", disabled: index === photos.length - 1, "aria-label": "Mover después" },
        "→",
      );
      const remove = h("button", { type: "button", class: "button button--small" }, "Eliminar");

      makeMain.addEventListener("click", () => void run(() => reorderPetPhotos(petId, move(index, 0))));
      left.addEventListener("click", () => void run(() => reorderPetPhotos(petId, move(index, index - 1))));
      right.addEventListener("click", () => void run(() => reorderPetPhotos(petId, move(index, index + 1))));
      remove.addEventListener("click", () => {
        if (window.confirm("¿Eliminar esta foto?")) void run(() => deletePetPhoto(petId, photo.id));
      });

      return h(
        "li",
        { class: "pet-photos__item" },
        h("img", { src: photo.url, alt: `Foto ${String(photo.position)}`, loading: "lazy" }),
        index === 0 ? h("span", { class: "badge badge--available" }, "Principal") : null,
        h("div", { class: "pet-photos__actions" }, left, right, makeMain, remove),
      );
    });

    section.replaceChildren(
      h(
        "div",
        { class: "page-title" },
        h("h2", {}, "Fotos"),
        addButton,
      ),
      h("p", { class: "muted" }, `Hasta ${String(maxPhotos)} fotos JPEG, PNG o WebP. La primera es la principal.`),
      ...(message ? [message] : []),
      photos.length === 0 ? h("p", { class: "muted" }, "Todavía no hay fotos.") : h("ul", { class: "pet-photos__list" }, ...items),
      input,
    );
  };

  section.append(h("p", { class: "muted" }, "Cargando fotos…"));
  listPetPhotos(petId).then(
    (response) => draw(response),
    (error: unknown) => draw({ photos: [], maxPhotos: 0 }, notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las fotos.")),
  );
  return section;
}
