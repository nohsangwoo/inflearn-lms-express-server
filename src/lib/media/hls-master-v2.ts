import fs from "node:fs/promises";

export type AudioEntry = {
    lang: string;
    name: string;
    uri: string;
    groupId: string;
    defaultFlag?: boolean;
};

export type VideoEntry = {
    bandwidth: number;
    resolution: string;
    codecs: string;
    uri: string;
    audioGroup: string;
};

export async function createMasterPlaylist(params: {
    masterPath: string;
    videoEntries: VideoEntry[];
    audioEntries: AudioEntry[];
}): Promise<void> {
    let content = "#EXTM3U\n";
    content += "#EXT-X-VERSION:6\n\n";

    // Add audio tracks
    for (const audio of params.audioEntries) {
        const def = audio.defaultFlag ? "YES" : "NO";
        content += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${audio.groupId}",NAME="${audio.name}",LANGUAGE="${audio.lang}",AUTOSELECT=YES,DEFAULT=${def},URI="${audio.uri}"\n`;
    }

    if (params.audioEntries.length > 0) {
        content += "\n";
    }

    // Add video streams
    for (const video of params.videoEntries) {
        content += `#EXT-X-STREAM-INF:BANDWIDTH=${video.bandwidth},RESOLUTION=${video.resolution},CODECS="${video.codecs}",AUDIO="${video.audioGroup}"\n`;
        content += video.uri + "\n";
    }

    await fs.writeFile(params.masterPath, content, "utf8");
}

export async function upsertMasterPlaylist(params: {
    masterPath: string;
    videoM3u8Rel: string;
    audioEntries: AudioEntry[];
}): Promise<void> {
    // For backward compatibility, create a single video entry
    const videoEntries: VideoEntry[] = [{
        bandwidth: 2500000,
        resolution: "1920x1080",
        codecs: "avc1.4d401f",
        uri: params.videoM3u8Rel,
        audioGroup: "aud"
    }];

    return createMasterPlaylist({
        masterPath: params.masterPath,
        videoEntries,
        audioEntries: params.audioEntries
    });
}

export async function patchMasterAddAudio(a: AudioEntry & { masterPath: string }): Promise<void> {
    const { masterPath, ...entry } = a;

    let content = "";
    try {
        content = await fs.readFile(masterPath, "utf8");
    } catch {
        // If file doesn't exist, create new one
        return createMasterPlaylist({
            masterPath,
            videoEntries: [],
            audioEntries: [entry]
        });
    }

    const lines = content.split("\n");
    const mediaLine = `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${entry.groupId}",NAME="${entry.name}",LANGUAGE="${entry.lang}",AUTOSELECT=YES,DEFAULT=${entry.defaultFlag ? "YES" : "NO"},URI="${entry.uri}"`;

    // Check if this language already exists
    const hasLang = lines.some(l =>
        l.includes(`LANGUAGE="${entry.lang}"`) && l.includes("TYPE=AUDIO")
    );

    if (!hasLang) {
        // Find the position to insert (before first STREAM-INF or at the end)
        const streamIdx = lines.findIndex(l => l.startsWith("#EXT-X-STREAM-INF"));
        if (streamIdx === -1) {
            lines.push(mediaLine);
        } else {
            // Insert before stream definitions with a blank line
            lines.splice(streamIdx, 0, mediaLine, "");
        }
        content = lines.join("\n");
        await fs.writeFile(masterPath, content, "utf8");
    }
}

export async function createMultiResolutionMaster(params: {
    masterPath: string;
    resolutions: Array<{
        name: string;
        bandwidth: number;
        resolution: string;
        codecs?: string;
    }>;
    audioEntries: AudioEntry[];
}): Promise<void> {
    const videoEntries: VideoEntry[] = params.resolutions.map(res => ({
        bandwidth: res.bandwidth,
        resolution: res.resolution,
        codecs: res.codecs || "avc1.4d401f",
        uri: `video/${res.name}/video.m3u8`,
        audioGroup: "aud"
    }));

    return createMasterPlaylist({
        masterPath: params.masterPath,
        videoEntries,
        audioEntries: params.audioEntries
    });
}