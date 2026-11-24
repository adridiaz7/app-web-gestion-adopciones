type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | undefined>;

/**
 * Creates an element. Text is always set as text, never as HTML, so user data cannot
 * inject markup. Boolean attributes are added when true and left out when false.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) element.setAttribute(name, "");
    else if (typeof value === "string") element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child) element.append(child);
  }
  return element;
}

/** Empties `root` and puts `content` in it. */
export function mount(root: HTMLElement, content: Node): void {
  root.replaceChildren(content);
}

/** A query parameter of the current address, or "" if missing. */
export function queryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}
