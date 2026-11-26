import { confirmEmailChange } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { authPage } from "../components/auth-layout.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";

function page(content: Node[]): HTMLElement {
  return authPage({ overline: "Cambiar el email", title: "Confirmación de tu email nuevo", icon: "✉", content });
}

/** CU-49 · /confirmar-email?token=… (the link sent to the new email). */
export async function renderConfirmEmailChange(root: HTMLElement): Promise<void> {
  mount(root, page([h("p", { class: "auth-card__subtitle" }, "Comprobando el enlace…")]));

  try {
    const { message } = await confirmEmailChange({ token: queryParam("token") });
    mount(root, page([notice("success", "Email cambiado", message), h("a", { class: "button button--primary button--block", href: "/perfil" }, "Ir a mi perfil")]));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Ha ocurrido un error inesperado.";
    mount(
      root,
      page([
        notice("error", "No hemos podido cambiar tu email", message),
        h("a", { class: "button button--secondary button--block", href: "/perfil" }, "Pedir un enlace nuevo desde mi perfil"),
      ]),
    );
  }
}
