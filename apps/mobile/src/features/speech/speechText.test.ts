import { describe, expect, it } from "vite-plus/test";
import { speechChunks, speechText } from "./speechText";

describe("speechText", () => {
  it("reads prose, link labels, inline code and tables without reading code blocks or image URLs", () => {
    const text = speechText(
      "# Answer\n\n**Hello** [there](https://secret.example/token). Use `npm install`.\n\n```js\nthrow new Error('secret');\n```\n\n![image](https://private.example/image)\n\n| One | Two |\n| --- | --- |\n| A | B |",
    );
    expect(text).toContain("Answer");
    expect(text).toContain("Hello there. Use npm install.");
    expect(text).toContain("Code block omitted.");
    expect(text).toContain("One\nTwo");
    expect(text).not.toMatch(/secret|https:|throw|private/);
  });

  it("splits long replies without losing text or breaking surrogate pairs", () => {
    const text = "a".repeat(2999) + "😀" + "b".repeat(4000);
    const chunks = speechChunks(text);
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    expect(speechChunks("  ")).toEqual([]);
  });
});
