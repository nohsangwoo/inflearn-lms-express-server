import { relations } from "drizzle-orm";
import { doublePrecision, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const now = () => new Date();
const textId = () => crypto.randomUUID();

export const languageEnum = pgEnum("Language", [
    "KO",
    "EN",
    "JA",
    "VI",
    "RU",
    "ZH",
    "ZH_CN",
    "ZH_TW",
    "FR",
    "DE",
    "ES",
    "PT",
    "IT",
    "ID",
    "TH",
    "HI",
    "AR",
    "TR",
    "PL",
    "UK",
]);
export const hlsStatusEnum = pgEnum("HlsStatus", ["PENDING", "PROCESSING", "READY", "FAILED"]);

export const curriculumSections = pgTable("CurriculumSection", {
    id: serial("id").primaryKey(),
});

export const videos = pgTable("Video", {
    id: serial("id").primaryKey(),
    title: text("title"),
    description: text("description"),
    videoUrl: text("videoUrl").notNull(),
    thumbnailUrl: text("thumbnailUrl"),
    duration: integer("duration"),
    language: languageEnum("language").notNull().default("KO"),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull().$onUpdate(now),
    curriculumSectionId: integer("curriculumSectionId").references(() => curriculumSections.id, {
        onDelete: "set null",
        onUpdate: "cascade",
    }),
    masterKey: text("masterKey").notNull(),
    hlsStatus: hlsStatusEnum("hlsStatus").notNull().default("PENDING"),
    hlsError: text("hlsError"),
});

export const dubTracks = pgTable(
    "DubTrack",
    {
        id: text("id").primaryKey().$defaultFn(textId),
        lang: text("lang").notNull(),
        status: text("status").notNull(),
        lufs: doublePrecision("lufs"),
        offsetMs: integer("offsetMs"),
        createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull().$onUpdate(now),
        videoId: integer("videoId").references(() => videos.id, { onDelete: "set null", onUpdate: "cascade" }),
        url: text("url"),
    },
    (table) => [uniqueIndex("DubTrack_videoId_lang_key").on(table.videoId, table.lang)],
);

export const videosRelations = relations(videos, ({ many }) => ({
    dubTracks: many(dubTracks),
}));

export const dubTracksRelations = relations(dubTracks, ({ one }) => ({
    video: one(videos, { fields: [dubTracks.videoId], references: [videos.id] }),
}));
