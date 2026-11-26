import type { BreedsResponse } from "../../shared/api.js";
import { createBreed, createSpecies, renameBreed, renameSpecies } from "../api/admin.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getBreeds } from "../api/pets.js";
import { appLayout } from "../components/app-layout.js";
import { onSubmit, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

type Species = BreedsResponse["species"][number];

/** A one-field form (name) that sends `save` and reloads; the API errors show inside it. */
function nameForm(label: string, value: string, buttonLabel: string, save: (name: string) => Promise<unknown>, done: () => void): HTMLFormElement {
  const input = h("input", { name: "name", value, maxlength: "100", "aria-label": label, placeholder: label });
  const form = h(
    "form",
    { class: "form catalogue-form" },
    h("div", { class: "field", "data-field": "name" }, input, h("p", { class: "field__error" })),
    h("button", { type: "submit", class: "button button--secondary button--small" }, buttonLabel),
  );
  onSubmit(form, async () => {
    await save(textValue(form, "name"));
    done();
  });
  return form;
}

/** An item with its name and an "Editar" button that turns into the rename form. */
function editableName(name: string, save: (name: string) => Promise<unknown>, done: () => void): HTMLElement {
  const item = h("div", { class: "catalogue-item" });
  const edit = h("button", { type: "button", class: "button button--secondary button--small" }, "Editar");
  edit.addEventListener("click", () => {
    item.replaceChildren(nameForm("Nombre", name, "Guardar", save, done));
  });
  item.append(h("span", {}, name), edit);
  return item;
}

function speciesCard(species: Species, reload: () => void): HTMLElement {
  return h(
    "article",
    { class: "card shelter-card" },
    editableName(species.name, (name) => renameSpecies(species.id, name), reload),
    h("h3", { class: "overline" }, "Razas"),
    h("div", { class: "catalogue-list" }, ...species.breeds.map((breed) => editableName(breed.name, (name) => renameBreed(breed.id, name), reload))),
    nameForm("Nueva raza", "", "Añadir raza", (name) => createBreed(species.id, name), reload),
  );
}

/** CU-42 · /admin/catalogos: add and rename species and breeds. */
export async function renderAdminCatalogues(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const reload = () => void renderAdminCatalogues(root);
  let list: Node;
  try {
    const { species } = await getBreeds();
    list = h("div", { class: "shelter-list" }, ...species.map((s) => speciesCard(s, reload)));
  } catch (error) {
    list = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar los catálogos.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Administración"),
      h("h1", { class: "display" }, "Catálogos"),
      h("p", { class: "muted" }, "Especies y razas que las protectoras eligen al crear una ficha."),
      nameForm("Nueva especie", "", "Añadir especie", createSpecies, reload),
      list,
    ]),
  );
}
