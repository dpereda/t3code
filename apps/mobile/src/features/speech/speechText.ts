import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);

function spokenNode(node: Root | RootContent): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "code":
      return "\nCode block omitted.\n";
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteDefinition":
      return "";
    case "break":
      return "\n";
    default: {
      if (!("children" in node)) return "";
      const separator = ["root", "list", "table", "tableRow"].includes(node.type) ? "\n" : "";
      const text = node.children.map(spokenNode).join(separator);
      return ["paragraph", "heading", "listItem", "blockquote", "table"].includes(node.type)
        ? `${text}\n`
        : text;
    }
  }
}

export function speechText(markdown: string): string {
  return spokenNode(parser.parse(markdown))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function speechChunks(text: string, limit = 3000): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const boundary = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf(" "),
    );
    let end = boundary > limit / 2 ? boundary + 1 : limit;
    // Avoid splitting UTF-16 surrogate pairs at a hard boundary.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end -= 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
