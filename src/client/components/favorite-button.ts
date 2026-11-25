import { ApiError } from "../api/client.js";
import { addFavorite, removeFavorite } from "../api/favorites.js";
import { h } from "../dom.js";

/**
 * CU-12, RN-73: a heart that adds the pet to favourites or removes it. `onError` shows
 * the reason when the change fails (for example, the pet is no longer available).
 */
export function favoriteButton(petId: number, isFavorite: boolean, onError: (message: string) => void, withText = false): HTMLButtonElement {
  let favorite = isFavorite;
  const button = h("button", { type: "button", class: withText ? "button button--secondary favorite-button" : "favorite-heart" });

  const draw = (): void => {
    button.setAttribute("aria-pressed", favorite ? "true" : "false");
    button.setAttribute("aria-label", favorite ? "Quitar de favoritos" : "Añadir a favoritos");
    button.textContent = withText ? `${favorite ? "♥" : "♡"} Favorito` : favorite ? "♥" : "♡";
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    (favorite ? removeFavorite(petId) : addFavorite(petId))
      .then(() => {
        favorite = !favorite;
        draw();
      })
      .catch((error: unknown) => onError(error instanceof ApiError ? error.message : "No se ha podido guardar el favorito."))
      .finally(() => (button.disabled = false));
  });

  draw();
  return button;
}
