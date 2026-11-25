import { currentUser } from "../api/auth.js";
import { getPreferences } from "../api/preferences.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

/** /inicio: start page of the logged-in area. The sections of each role arrive with their tasks. */
export async function renderHome(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Inicio"),
      h("h1", { class: "display" }, "Hola de nuevo"),
      notice("info", "Has iniciado sesión", `Estás dentro con ${user.email}.`),
      ...(user.role === "ADOPTER" ? await questionnaireOffer() : []),
    ]),
  );
}

/** RN-30: while the adopter has not filled in the questionnaire, it is offered (it is optional). */
async function questionnaireOffer(): Promise<Node[]> {
  try {
    if ((await getPreferences()).preferences) return [];
  } catch {
    return [];
  }
  return [
    h(
      "section",
      { class: "card offer" },
      h("h2", {}, "¿Qué mascota buscas?"),
      h("p", { class: "muted" }, "Responde un cuestionario breve y opcional para que te recomendemos mascotas compatibles."),
      h("a", { class: "button button--primary", href: "/perfil/preferencias" }, "Rellenar el cuestionario"),
    ),
  ];
}

/** Any address the app does not know. */
export function renderNotFound(root: HTMLElement): void {
  mount(
    root,
    h(
      "main",
      { class: "not-found" },
      h("h1", {}, "No encontramos esta página"),
      h("p", {}, "Puede que la dirección esté mal escrita o que la página ya no exista."),
      h("a", { class: "button button--primary", href: "/" }, "Ir al inicio"),
    ),
  );
}

/** /: with a session, the logged-in area; without one, the public gallery (RN-187). */
export async function renderRoot(): Promise<void> {
  navigate((await currentUser()) ? "/inicio" : "/mascotas", { replace: true });
}
