import type { GalleriesFile, GalleryDetailsFile } from "./types";

export const CURRENT_GALLERIES_SCHEMA = 1;
export const CURRENT_DETAILS_SCHEMA = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSchemaVersion(data: unknown): number {
  if (isRecord(data) && typeof data.schemaVersion === "number") {
    return data.schemaVersion;
  }
  return 0;
}

// --- galleries.json migrations ---

function migrateGalleriesV0toV1(raw: unknown): GalleriesFile {
  // v0: plain array of gallery entries
  // v0 alt: object with no schemaVersion
  if (Array.isArray(raw)) {
    return { schemaVersion: 1, galleries: raw };
  }
  if (isRecord(raw) && Array.isArray(raw.galleries)) {
    return { schemaVersion: 1, galleries: raw.galleries as GalleriesFile["galleries"] };
  }
  // Fallback: empty
  return { schemaVersion: 1, galleries: [] };
}

const galleriesMigrations: Record<number, (data: unknown) => GalleriesFile> = {
  0: migrateGalleriesV0toV1,
};

export function migrateGalleries(raw: unknown): { data: GalleriesFile; migrated: boolean } {
  let version = getSchemaVersion(raw);

  if (version > CURRENT_GALLERIES_SCHEMA) {
    throw new Error(
      `galleries.json has schema version ${version}, but this app only supports up to ${CURRENT_GALLERIES_SCHEMA}. Please update the app.`
    );
  }

  if (version === CURRENT_GALLERIES_SCHEMA && isRecord(raw)) {
    return { data: raw as unknown as GalleriesFile, migrated: false };
  }

  let data: unknown = raw;
  const startVersion = version;
  while (version < CURRENT_GALLERIES_SCHEMA) {
    const migration = galleriesMigrations[version];
    if (!migration) {
      throw new Error(`No migration found for galleries.json schema version ${version}`);
    }
    data = migration(data);
    version = (data as GalleriesFile).schemaVersion;
  }

  return { data: data as GalleriesFile, migrated: startVersion !== version };
}

// --- gallery-details.json migrations ---

function migrateDetailsV0toV1(raw: unknown): GalleryDetailsFile {
  if (isRecord(raw)) {
    return { ...raw, schemaVersion: 1 } as GalleryDetailsFile;
  }
  throw new Error("gallery-details.json is not a valid object");
}

const detailsMigrations: Record<number, (data: unknown) => GalleryDetailsFile> = {
  0: migrateDetailsV0toV1,
};

export function migrateGalleryDetails(raw: unknown): { data: GalleryDetailsFile; migrated: boolean } {
  let version = getSchemaVersion(raw);

  if (version > CURRENT_DETAILS_SCHEMA) {
    throw new Error(
      `gallery-details.json has schema version ${version}, but this app only supports up to ${CURRENT_DETAILS_SCHEMA}. Please update the app.`
    );
  }

  if (version === CURRENT_DETAILS_SCHEMA && isRecord(raw)) {
    return { data: raw as unknown as GalleryDetailsFile, migrated: false };
  }

  let data: unknown = raw;
  const startVersion = version;
  while (version < CURRENT_DETAILS_SCHEMA) {
    const migration = detailsMigrations[version];
    if (!migration) {
      throw new Error(`No migration found for gallery-details.json schema version ${version}`);
    }
    data = migration(data);
    version = (data as GalleryDetailsFile).schemaVersion;
  }

  return { data: data as GalleryDetailsFile, migrated: startVersion !== version };
}
