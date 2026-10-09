import { describe, expect, it } from "vitest";
import {
  HTML5_NATIVE_DROP_GUARD_MS,
  fileUrlToFsPath,
  isFileDrag,
  pathsFromDataTransfer,
  pathsFromDroppedFiles,
  pathsFromUriList,
  shouldSkipHtml5AfterNative,
} from "./fileDrop";

function dt(partial: {
  types?: string[];
  files?: { length: number } | File[];
  items?: Array<{ kind: string }>;
  getData?: (type: string) => string;
}): DataTransfer {
  const files = Array.isArray(partial.files)
    ? partial.files
    : partial.files;
  return {
    types: partial.types ?? [],
    files: files as FileList,
    items: partial.items as unknown as DataTransferItemList,
    getData: partial.getData ?? (() => ""),
  } as unknown as DataTransfer;
}

describe("isFileDrag", () => {
  it("rejects null / empty", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(dt({ types: ["text/plain"] }))).toBe(false);
  });

  it("accepts Files / moz-file / uri-list", () => {
    expect(isFileDrag(dt({ types: ["Files"] }))).toBe(true);
    expect(isFileDrag(dt({ types: ["application/x-moz-file"] }))).toBe(true);
    expect(isFileDrag(dt({ types: ["text/uri-list"] }))).toBe(true);
  });

  it("accepts FileList or items kind=file even without types", () => {
    expect(isFileDrag(dt({ types: [], files: { length: 1 } }))).toBe(true);
    expect(isFileDrag(dt({ types: [], items: [{ kind: "file" }] }))).toBe(
      true,
    );
  });
});

describe("pathsFromDroppedFiles", () => {
  it("keeps unique non-empty File.path", () => {
    const a = { name: "a.png", path: "/tmp/a.png" } as File & { path: string };
    const b = { name: "b.png", path: "" } as File & { path: string };
    const c = { name: "a2.png", path: "/tmp/a.png" } as File & { path: string };
    expect(pathsFromDroppedFiles([a, b, c])).toEqual(["/tmp/a.png"]);
  });
});

describe("fileUrlToFsPath / pathsFromUriList", () => {
  it("decodes file URLs including Windows drive letters", () => {
    expect(fileUrlToFsPath("file:///tmp/proj")).toBe("/tmp/proj");
    expect(fileUrlToFsPath("file:///C:/Users/a/proj")).toBe("C:/Users/a/proj");
    expect(fileUrlToFsPath("https://example.com/a")).toBeNull();
  });

  it("keeps absolute paths and skips http links", () => {
    expect(
      pathsFromUriList(
        [
          "# comment",
          "file:///C:/Work/demo",
          "https://example.com/x",
          "D:\\Repos\\app",
          "/Users/me/code",
        ].join("\n"),
      ),
    ).toEqual(["C:/Work/demo", "D:\\Repos\\app", "/Users/me/code"]);
  });
});

describe("pathsFromDataTransfer", () => {
  it("merges File.path and uri-list without duplicates", () => {
    const file = {
      name: "a",
      path: "C:/Work/demo",
    } as File & { path: string };
    const data = dt({
      types: ["Files", "text/uri-list"],
      files: [file],
      getData: (type) =>
        type === "text/uri-list"
          ? "file:///C:/Work/demo\nfile:///C:/Work/other"
          : "",
    });
    expect(pathsFromDataTransfer(data)).toEqual([
      "C:/Work/demo",
      "C:/Work/other",
    ]);
  });
});

describe("shouldSkipHtml5AfterNative", () => {
  it("skips only inside the guard window", () => {
    expect(shouldSkipHtml5AfterNative(1000, 1000)).toBe(true);
    expect(
      shouldSkipHtml5AfterNative(1000, 1000 + HTML5_NATIVE_DROP_GUARD_MS - 1),
    ).toBe(true);
    expect(
      shouldSkipHtml5AfterNative(1000, 1000 + HTML5_NATIVE_DROP_GUARD_MS),
    ).toBe(false);
    expect(shouldSkipHtml5AfterNative(0, 50)).toBe(false);
  });
});
