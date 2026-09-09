// The one escape used by every document preview renderer.
//
// Preview HTML is built from customer document content and displayed in a frame, so the
// text has to stop being text before it becomes markup. It lives in its own module
// because two renderers need it and neither should own the other.
/** Escapes every character that could break out of text or an attribute value. */
export function escapeDocumentHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
