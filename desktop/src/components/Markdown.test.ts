import { describe, expect, it } from "vitest";
import { imageAt } from "./Markdown";

describe("chat Markdown images", () => {
  it("reads local image paths, with spaces and angle brackets", () => {
    expect(imageAt("![shot](D:\Work\.dispatch\outputs\boss\a.png)")).toEqual({ alt: "shot", src: "D:\Work\.dispatch\outputs\boss\a.png" });
    expect(imageAt("  ![](<C:\My Files (x86)\b.jpg>)  ")).toEqual({ alt: "", src: "C:\My Files (x86)\b.jpg" });
  });
  it("ignores remote URLs, data URLs and text around the image", () => {
    expect(imageAt("![x](https://example.com/a.png)")).toBeNull();
    expect(imageAt("![x](data:image/png;base64,AAA)")).toBeNull();
    expect(imageAt("see ![x](a.png)")).toBeNull();
    expect(imageAt("[link](a.png)")).toBeNull();
  });
});
