/**
 * Sanitize SheetJS sheet_to_html output before dangerouslySetInnerHTML.
 * Strips scripts, event handlers, and javascript: URLs; keeps table markup.
 */
export function sanitizeOfficeSheetHtml(html: string): string {
  if (!html) return "";
  let out = html;
  // Remove script/style/iframe/object/embed blocks
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\s*\1\s*>/gi, "");
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "");
  // Remove inline event handlers (onClick=, onerror=, …)
  out = out.replace(/\s+on[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
  // Neutralize javascript: / data:text/html URLs in href/src — quoted first,
  // then unquoted (HTML allows `href=javascript:…` without quotes).
  out = out.replace(
    /\s(href|src|xlink:href)\s*=\s*(['"])\s*(javascript:|data:\s*text\/html)[\s\S]*?\2/gi,
    ' $1="#"',
  );
  out = out.replace(
    /\s(href|src|xlink:href)(\s*=\s*)(javascript|data\s*:\s*text\s*\/\s*html)[^\s>]*/gi,
    ' $1="#"',
  );
  // srcdoc carries a nested HTML document whose content survives the block
  // strippers above — drop the attribute entirely.
  out = out.replace(/\ssrcdoc\s*=\s*(['"])[\s\S]*?\1/gi, "");
  out = out.replace(/\ssrcdoc\s*=\s*[^\s>]+/gi, "");
  // Drop <base> tags that could rewrite relative URLs
  out = out.replace(/<\s*base\b[^>]*>/gi, "");
  return out;
}
