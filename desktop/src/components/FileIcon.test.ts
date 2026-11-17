import { describe, expect, it } from "vitest";
import { iconForDir, iconForFile } from "./FileIcon";

describe("iconForFile", () => {
  it("maps common languages and configs", () => {
    expect(iconForFile("app.ts")).toBe("typescript");
    expect(iconForFile("App.tsx")).toBe("react_ts");
    expect(iconForFile("index.js")).toBe("javascript");
    expect(iconForFile("mod.mjs")).toBe("javascript");
    expect(iconForFile("main.cjs")).toBe("javascript");
    expect(iconForFile("Button.jsx")).toBe("react");
    expect(iconForFile("data.json")).toBe("json");
    expect(iconForFile("README.md")).toBe("markdown");
    expect(iconForFile("style.css")).toBe("css");
    expect(iconForFile("theme.scss")).toBe("sass");
    expect(iconForFile("index.html")).toBe("html");
    expect(iconForFile("train.py")).toBe("python");
    expect(iconForFile("server.go")).toBe("go");
    expect(iconForFile("lib.rs")).toBe("rust");
    expect(iconForFile("Main.java")).toBe("java");
    expect(iconForFile("App.kt")).toBe("kotlin");
    expect(iconForFile("main.c")).toBe("c");
    expect(iconForFile("engine.cpp")).toBe("cpp");
    expect(iconForFile("engine.h")).toBe("h");
    expect(iconForFile("Program.cs")).toBe("csharp");
    expect(iconForFile("index.php")).toBe("php");
    expect(iconForFile("Rakefile.rb")).toBe("ruby");
    expect(iconForFile("App.swift")).toBe("swift");
    expect(iconForFile("run.sh")).toBe("console");
    expect(iconForFile("setup.ps1")).toBe("powershell");
    expect(iconForFile("build.bat")).toBe("console");
    expect(iconForFile("ci.yml")).toBe("yaml");
    expect(iconForFile("config.yaml")).toBe("yaml");
    expect(iconForFile("Cargo.toml")).toBe("toml");
    expect(iconForFile("pom.xml")).toBe("xml");
    expect(iconForFile("schema.sql")).toBe("database");
    expect(iconForFile(".env")).toBe("tune");
    expect(iconForFile(".env.local")).toBe("tune");
    expect(iconForFile(".gitignore")).toBe("git");
    expect(iconForFile("Dockerfile")).toBe("docker");
    expect(iconForFile("Dockerfile.prod")).toBe("docker");
  });

  it("maps lock files, special configs, media, 3d, and text", () => {
    expect(iconForFile("package.json")).toBe("nodejs");
    expect(iconForFile("package-lock.json")).toBe("lock");
    expect(iconForFile("yarn.lock")).toBe("yarn");
    expect(iconForFile("pnpm-lock.yaml")).toBe("pnpm");
    expect(iconForFile("tsconfig.json")).toBe("tsconfig");
    expect(iconForFile("tsconfig.node.json")).toBe("tsconfig");
    expect(iconForFile("vite.config.ts")).toBe("vite");
    expect(iconForFile("logo.png")).toBe("image");
    expect(iconForFile("photo.jpg")).toBe("image");
    expect(iconForFile("icon.svg")).toBe("svg");
    expect(iconForFile("anim.gif")).toBe("image");
    expect(iconForFile("hero.webp")).toBe("image");
    expect(iconForFile("favicon.ico")).toBe("image");
    expect(iconForFile("bell.mp3")).toBe("audio");
    expect(iconForFile("demo.mp4")).toBe("video");
    expect(iconForFile("spec.pdf")).toBe("pdf");
    expect(iconForFile("bundle.zip")).toBe("zip");
    expect(iconForFile("mesh.fbx")).toBe("3d");
    expect(iconForFile("model.glb")).toBe("3d");
    expect(iconForFile("scene.gltf")).toBe("3d");
    expect(iconForFile("prop.blend")).toBe("blender");
    expect(iconForFile("actor.uasset")).toBe("3d");
    expect(iconForFile("notes.txt")).toBe("document");
    expect(iconForFile("app.log")).toBe("log");
    expect(iconForFile("rows.csv")).toBe("table");
  });

  it("strips parent path and falls back to generic file", () => {
    expect(iconForFile("desktop/src/ide/IdePanel.tsx")).toBe("react_ts");
    expect(iconForFile("unknown.xyz123")).toBe("file");
    expect(iconForFile("LICENSE")).toBe("file");
  });
});

describe("iconForDir", () => {
  it("maps common folder names with open and closed variants", () => {
    expect(iconForDir("src")).toBe("folder-src");
    expect(iconForDir("src", true)).toBe("folder-src-open");
    expect(iconForDir("electron")).toBe("folder-desktop");
    expect(iconForDir("electron", true)).toBe("folder-desktop-open");
    expect(iconForDir("components")).toBe("folder-components");
    expect(iconForDir("assets")).toBe("folder-resource");
    expect(iconForDir("public")).toBe("folder-public");
    expect(iconForDir("node_modules")).toBe("folder-node");
    expect(iconForDir("test")).toBe("folder-test");
    expect(iconForDir("tests")).toBe("folder-test");
    expect(iconForDir("e2e")).toBe("folder-test");
    expect(iconForDir("docs")).toBe("folder-docs");
    expect(iconForDir("scripts")).toBe("folder-scripts");
    expect(iconForDir("dist")).toBe("folder-dist");
    expect(iconForDir("build")).toBe("folder-dist");
    expect(iconForDir("release")).toBe("folder-dist");
    expect(iconForDir(".git")).toBe("folder-git");
    expect(iconForDir(".github")).toBe("folder-github");
    expect(iconForDir(".vscode")).toBe("folder-vscode");
    expect(iconForDir(".dispatch")).toBe("folder-config");
    expect(iconForDir(".dispatch", true)).toBe("folder-config-open");
  });

  it("falls back to generic folder", () => {
    expect(iconForDir("custom-dir")).toBe("folder");
    expect(iconForDir("custom-dir", true)).toBe("folder-open");
  });
});
