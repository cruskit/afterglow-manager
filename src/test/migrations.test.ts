import { describe, it, expect } from "vitest";
import {
  migrateGalleries,
  migrateGalleryDetails,
  CURRENT_GALLERIES_SCHEMA,
  CURRENT_DETAILS_SCHEMA,
} from "../migrations";

describe("migrateGalleries", () => {
  it("migrates legacy plain array to wrapped format", () => {
    const legacy = [
      { name: "Sunset", slug: "sunset", date: "Feb 2026", cover: "sunset/01.jpg" },
    ];
    const { data, migrated } = migrateGalleries(legacy);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(1);
    expect(data.galleries).toEqual(legacy);
  });

  it("migrates object without schemaVersion", () => {
    const legacy = {
      galleries: [{ name: "A", slug: "a", date: "", cover: "" }],
    };
    const { data, migrated } = migrateGalleries(legacy);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(1);
    expect(data.galleries).toEqual(legacy.galleries);
  });

  it("does not migrate already-current format", () => {
    const current = {
      schemaVersion: 1,
      galleries: [{ name: "A", slug: "a", date: "", cover: "" }],
    };
    const { data, migrated } = migrateGalleries(current);
    expect(migrated).toBe(false);
    expect(data).toEqual(current);
  });

  it("handles empty array", () => {
    const { data, migrated } = migrateGalleries([]);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(1);
    expect(data.galleries).toEqual([]);
  });

  it("throws on future schema version", () => {
    const future = { schemaVersion: 999, galleries: [] };
    expect(() => migrateGalleries(future)).toThrow(
      `galleries.json has schema version 999, but this app only supports up to ${CURRENT_GALLERIES_SCHEMA}`
    );
  });
});

describe("migrateGalleryDetails", () => {
  it("migrates legacy details without schemaVersion", () => {
    const legacy = {
      name: "Sunset",
      slug: "sunset",
      date: "Feb 2026",
      description: "Beautiful sunset",
      photos: [{ thumbnail: "01.jpg", full: "01.jpg", alt: "01" }],
    };
    const { data, migrated } = migrateGalleryDetails(legacy);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(1);
    expect(data.name).toBe("Sunset");
    expect(data.photos).toEqual(legacy.photos);
  });

  it("does not migrate already-current format", () => {
    const current = {
      schemaVersion: 1,
      name: "Sunset",
      slug: "sunset",
      date: "Feb 2026",
      description: "",
      photos: [],
    };
    const { data, migrated } = migrateGalleryDetails(current);
    expect(migrated).toBe(false);
    expect(data).toEqual(current);
  });

  it("throws on future schema version", () => {
    const future = {
      schemaVersion: 999,
      name: "X",
      slug: "x",
      date: "",
      description: "",
      photos: [],
    };
    expect(() => migrateGalleryDetails(future)).toThrow(
      `gallery-details.json has schema version 999, but this app only supports up to ${CURRENT_DETAILS_SCHEMA}`
    );
  });

  it("throws on non-object input", () => {
    expect(() => migrateGalleryDetails("not an object")).toThrow(
      "gallery-details.json is not a valid object"
    );
  });
});
