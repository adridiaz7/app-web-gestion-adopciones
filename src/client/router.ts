import { matchPath, type RouteParams } from "./route-match.js";

export type { RouteParams };

export interface Route {
  path: string;
  /** Draws the view inside `root`. */
  render: (root: HTMLElement, params: RouteParams) => void | Promise<void>;
}

let routes: Route[] = [];
let notFound: Route["render"] = () => undefined;
let appRoot: HTMLElement | undefined;

async function renderCurrent(): Promise<void> {
  if (!appRoot) return;
  const path = window.location.pathname;
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) {
      await route.render(appRoot, params);
      return;
    }
  }
  await notFound(appRoot, {});
}

/** Goes to another page of the app without reloading (History API). */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.scrollTo(0, 0);
  void renderCurrent();
}

/**
 * Starts the router: draws the current page, follows the browser's back and forward
 * buttons, and turns clicks on internal links into navigation without reloading.
 */
export function startRouter(root: HTMLElement, appRoutes: Route[], renderNotFound: Route["render"]): void {
  appRoot = root;
  routes = appRoutes;
  notFound = renderNotFound;

  window.addEventListener("popstate", () => void renderCurrent());
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || link.target || link.origin !== window.location.origin || link.pathname.startsWith("/api")) return;
    event.preventDefault();
    navigate(link.pathname + link.search);
  });

  void renderCurrent();
}
