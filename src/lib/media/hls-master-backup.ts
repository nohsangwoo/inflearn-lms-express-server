import fs from "node:fs/promises";

export type AudioEntry = { lang: string; name: string; uri: string; groupId: string; defaultFlag?: boolean };

export async function upsertMasterPlaylist(params: {
    masterPath: string;
    videoM3u8Rel: string; // e.g., "video/video.m3u8"
    audioEntries: AudioEntry[];
}): Promise<void> {
    let content = "";
    try { content = await fs.readFile(params.masterPath, "utf8"); } catch {}
    if (!content) content = "#EXTM3U\n";

    const lines = content.split("\n").filter(l => !l.startsWith("#EXT-X-MEDIA") && !l.startsWith("#EXT-X-STREAM-INF"));
    let out = lines.join("\n").trim() + "\n";

    for (const a of params.audioEntries) {
        out += mediaLine(a) + "\n";
    }
    out += `#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f",RESOLUTION=1920x1080,AUDIO="aud"\n`;
    out += params.videoM3u8Rel + "\n";

    await fs.writeFile(params.masterPath, out, "utf8");
}

export async function patchMasterAddAudio(a: AudioEntry & { masterPath: string }): Promise<void> {
    const { masterPath, ...entry } = a;
    let content = await fs.readFile(masterPath, "utf8");
    const media = mediaLine(entry);
    const lines = content.split("\n");
    const has = lines.some(l => l.includes(`LANGUAGE="${entry.lang}"`) || l.includes(`NAME="${entry.name}"`));
    if (!has) {
        const idx = lines.findIndex(l => l.startsWith("#EXT-X-STREAM-INF"));
        if (idx === -1) lines.push(media);
        else lines.splice(idx, 0, media);
        content = lines.join("\n");
        await fs.writeFile(masterPath, content, "utf8");
    }
}

function mediaLine(a: AudioEntry): string {
    const def = a.defaultFlag ? "YES" : "NO";
    return `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${a.groupId}",NAME="${a.name}",LANGUAGE="${a.lang}",AUTOSELECT=YES,DEFAULT=${def},URI="${a.uri}"`;
}


