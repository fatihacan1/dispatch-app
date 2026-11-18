import { describe, expect, it } from "vitest";
import { imageAt, mediaAt } from "./Markdown";

describe("chat Markdown images", () => {
  it("reads local image paths, with spaces and angle brackets", () => {
    expect(imageAt("![shot](D:\Work\.dispatch\outputs\boss\a.png)")).toEqual({ alt: "shot", src: "D:\Work\.dispatch\outputs\boss\a.png" });
    expect(imageAt("  ![](<C:\My Files (x86)\b.jpg>)  ")).toEqual({ alt: "", src: "C:\My Files (x86)\b.jpg" });
  });
  it("ignores remote URLs, data URLs, video/audio, and text around the image", () => {
    expect(imageAt("![x](https://example.com/a.png)")).toBeNull();
    expect(imageAt("![x](data:image/png;base64,AAA)")).toBeNull();
    expect(imageAt("![x](D:\\a.mp4)")).toBeNull();
    expect(imageAt("see ![x](a.png)")).toBeNull();
    expect(imageAt("[link](a.png)")).toBeNull();
  });
});

describe("chat Markdown video and audio", () => {
  it("matches local video and audio in ![alt](path), [label](path), and plain paths", () => {
    expect(mediaAt("![clip](D:\\Work\\.dispatch\\outputs\\media\\a.mp4)")).toEqual({ kind: "video", alt: "clip", src: "D:\\Work\\.dispatch\\outputs\\media\\a.mp4", remote: false });
    expect(mediaAt("[watch](<C:\\My Files\\b.webm>)")).toEqual({ kind: "video", alt: "watch", src: "C:\\My Files\\b.webm", remote: false });
    expect(mediaAt("D:\\Work\\.dispatch\\outputs\\media\\take 1.mov")).toEqual({ kind: "video", alt: "", src: "D:\\Work\\.dispatch\\outputs\\media\\take 1.mov", remote: false });
    expect(mediaAt("/tmp/out/clip.m4v")).toEqual({ kind: "video", alt: "", src: "/tmp/out/clip.m4v", remote: false });
    expect(mediaAt("![song](D:\\out\\track.mp3)")).toEqual({ kind: "audio", alt: "song", src: "D:\\out\\track.mp3", remote: false });
    expect(mediaAt("/out/voice.wav")).toEqual({ kind: "audio", alt: "", src: "/out/voice.wav", remote: false });
    expect(mediaAt(".dispatch/outputs/a.ogg")).toEqual({ kind: "audio", alt: "", src: ".dispatch/outputs/a.ogg", remote: false });
    expect(mediaAt("![m4a](D:\\a.m4a)")).toEqual({ kind: "audio", alt: "m4a", src: "D:\\a.m4a", remote: false });
    expect(mediaAt("![flac](D:\\a.flac)")).toEqual({ kind: "audio", alt: "flac", src: "D:\\a.flac", remote: false });
  });

  it("matches https:// remote media and rejects http://, data:, and non-media", () => {
    expect(mediaAt("https://cdn.example.com/clip.mp4?token=1")).toEqual({ kind: "video", alt: "", src: "https://cdn.example.com/clip.mp4?token=1", remote: true });
    expect(mediaAt("![audio](https://cdn.example.com/song.mp3)")).toEqual({ kind: "audio", alt: "audio", src: "https://cdn.example.com/song.mp3", remote: true });
    expect(mediaAt("http://cdn.example.com/clip.mp4")).toBeNull();
    expect(mediaAt("![v](http://cdn.example.com/clip.mp4)")).toBeNull();
    expect(mediaAt("![v](data:video/mp4;base64,AAA)")).toBeNull();
    expect(mediaAt("see D:\\a.mp4")).toBeNull();
    expect(mediaAt("clip.mp4")).toBeNull();
    expect(mediaAt("https://cdn.example.com/page.html")).toBeNull();
  });
});
