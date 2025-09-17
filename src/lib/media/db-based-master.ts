import fs from "node:fs/promises";
import { prisma } from "../prisma.js";

export type AudioEntry = { lang: string; name: string; uri: string; groupId: string; defaultFlag?: boolean };

/**
 * Generate master playlist based on DB DubTrack data
 * This ensures the master.m3u8 always reflects the current state of available dubbing tracks
 */
export async function generateMasterPlaylistFromDB(params: {
    videoId: number;
    masterPath: string;
    videoM3u8Rel: string; // e.g., "video/video.m3u8"
    basePrefix: string; // e.g., "assets/curriculumsection/3/"
}): Promise<void> {
    console.log(`[DB-Master] Generating master playlist for video ${params.videoId}`);

    try {
        // Get all ready DubTrack records for this video
        const dubTracks = await prisma.dubTrack.findMany({
            where: {
                videoId: params.videoId,
                status: "ready"
            },
            orderBy: {
                lang: 'asc'
            }
        });

        console.log(`[DB-Master] Found ${dubTracks.length} ready dub tracks:`, dubTracks.map(t => t.lang));

        // Create audio entries from DB data
        const audioEntries: AudioEntry[] = dubTracks.map(track => ({
            lang: track.lang,
            name: track.lang,
            uri: `audio/${track.lang}/audio.m3u8`,
            groupId: "aud",
            defaultFlag: track.lang === "ja" || track.lang === "ko" // Japanese or Korean as default
        }));

        console.log(`[DB-Master] Generated audio entries:`, audioEntries);

        // Generate master playlist content
        let out = "#EXTM3U\n";
        out += "#EXT-X-VERSION:7\n";

        // Add audio track entries
        for (const a of audioEntries) {
            out += mediaLine(a) + "\n";
        }

        // Add video stream with audio group reference
        out += `#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="aud"\n`;
        out += params.videoM3u8Rel + "\n";

        // Write to file
        await fs.writeFile(params.masterPath, out, "utf8");
        console.log(`[DB-Master] Master playlist written to: ${params.masterPath}`);
        console.log(`[DB-Master] Content:\n${out}`);

    } catch (error) {
        console.error(`[DB-Master] Error generating master playlist:`, error);
        throw error;
    }
}

/**
 * Update master playlist for a specific section based on its video's DubTrack data
 */
export async function updateMasterPlaylistForSection(sectionId: number): Promise<void> {
    console.log(`[DB-Master] Updating master playlist for section ${sectionId}`);

    try {
        // Find video for this section
        const video = await prisma.video.findFirst({
            where: {
                curriculumSectionId: sectionId
            },
            include: {
                DubTrack: {
                    where: {
                        status: "ready"
                    },
                    orderBy: {
                        lang: 'asc'
                    }
                }
            }
        });

        if (!video) {
            console.warn(`[DB-Master] No video found for section ${sectionId}`);
            return;
        }

        console.log(`[DB-Master] Found video ${video.id} with ${video.DubTrack.length} ready tracks`);

        // Prepare paths
        const basePrefix = `assets/curriculumsection/${sectionId}/`;
        const masterPath = `/tmp/master_section_${sectionId}.m3u8`; // Temporary path for generation

        await generateMasterPlaylistFromDB({
            videoId: video.id,
            masterPath,
            videoM3u8Rel: "video/video.m3u8",
            basePrefix
        });

        console.log(`[DB-Master] Master playlist updated for section ${sectionId}`);

    } catch (error) {
        console.error(`[DB-Master] Error updating master playlist for section ${sectionId}:`, error);
        throw error;
    }
}

/**
 * Refresh master playlist whenever DubTrack data changes
 * This should be called after any dubbing operation completes
 */
export async function refreshMasterPlaylist(params: {
    sectionId: number;
    masterPath: string;
}): Promise<void> {
    console.log(`[DB-Master] Refreshing master playlist for section ${params.sectionId}`);

    try {
        // Find video for this section
        const video = await prisma.video.findFirst({
            where: {
                curriculumSectionId: params.sectionId
            }
        });

        if (!video) {
            console.warn(`[DB-Master] No video found for section ${params.sectionId}`);
            return;
        }

        await generateMasterPlaylistFromDB({
            videoId: video.id,
            masterPath: params.masterPath,
            videoM3u8Rel: "video/video.m3u8",
            basePrefix: `assets/curriculumsection/${params.sectionId}/`
        });

        console.log(`[DB-Master] Master playlist refreshed successfully`);

    } catch (error) {
        console.error(`[DB-Master] Error refreshing master playlist:`, error);
        throw error;
    }
}

function mediaLine(a: AudioEntry): string {
    const def = a.defaultFlag ? "YES" : "NO";
    return `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${a.groupId}",NAME="${a.name}",LANGUAGE="${a.lang}",AUTOSELECT=YES,DEFAULT=${def},URI="${a.uri}"`;
}