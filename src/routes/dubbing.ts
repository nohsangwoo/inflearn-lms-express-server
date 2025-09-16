import { Router } from "express";
import type { Router as ExpressRouter, Request } from "express";
import { dubVideoWithElevenLabs, type DubbingRequest } from "../services/dubbing.js";
import type { DubbingLanguageCode } from "../lib/elevenlabs.js";
// import { uploadFileToS3 } from "../lib/s3.js";
import { prisma } from "../lib/prisma.js";
import { copyObjectInS3, objectExistsInS3 } from "../lib/s3.js";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { uploadDirToS3 } from "../lib/s3-upload-dir.js";
import { upsertMasterPlaylist, patchMasterAddAudio } from "../lib/media/hls-master.js";
// import path from "node:path";

export const router: ExpressRouter = Router();

interface BodyShape {
	inputVideoPath?: string;
	inputVideoUrl?: string; // 원본 비디오 URL
	targetLanguages: DubbingLanguageCode[];
	outputDir?: string;
	apiKey?: string;
	curriculumSectionId?: number;
}

function validateBody(req: Request): BodyShape {
	const src = { ...(req.body ?? {}), ...(req.query ?? {}) } as Partial<BodyShape>;
	const { inputVideoPath, inputVideoUrl, targetLanguages, outputDir, apiKey, curriculumSectionId } = src;
	if ((!inputVideoPath || inputVideoPath.length === 0) && (!inputVideoUrl || inputVideoUrl.length === 0)) {
		const err = new Error("inputVideoPath 또는 inputVideoUrl 중 하나가 필요합니다") as Error & { status?: number };
		err.status = 400;
		throw err;
	}
	if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
		const err = new Error("targetLanguages 배열이 필요합니다") as Error & { status?: number };
		err.status = 400;
		throw err;
	}
	const allowed: readonly DubbingLanguageCode[] = [
		"ar","bg","cs","da","de","el","en","es","fi","fr",
		"he","hi","hu","id","it","ja","ko","ms","nl","no",
		"pl","pt","ro","ru","sk","sv","th","tr","uk","vi",
		"zh","fil"
	];
	for (const lang of targetLanguages) {
		if (!allowed.includes(lang)) {
			const err = new Error(`지원하지 않는 targetLanguage: ${lang}`) as Error & { status?: number };
			err.status = 400;
			throw err;
		}
	}
	if (curriculumSectionId !== undefined && !Number.isFinite(curriculumSectionId)) {
		const err = new Error("curriculumSectionId는 number 여야 합니다") as Error & { status?: number };
		err.status = 400;
		throw err;
	}
	return { inputVideoPath, inputVideoUrl, targetLanguages, outputDir, apiKey, curriculumSectionId } as BodyShape;
}

router.post("/", async (req, res, next) => {
	try {
		const body = validateBody(req);

		// 원본 Video 생성 (inputVideoUrl 기준) - masterKey는 임시로 설정
		const initialMasterKey = `assets/${Date.now()}-${Math.floor(Math.random()*1e6)}/master.m3u8`;
		const video = await prisma.video.create({
			data: {
				videoUrl: body.inputVideoUrl ?? body.inputVideoPath!,
				masterKey: initialMasterKey,
				updatedAt: new Date(),
				...(body.curriculumSectionId !== undefined ? { curriculumSectionId: body.curriculumSectionId } : {}),
			},
		});

		const results: Array<{ lang: DubbingLanguageCode; dubbingId: string; outputKey: string; url: string; }> = [];
		for (const lang of body.targetLanguages) {
			const reqObj: DubbingRequest = {
				targetLanguage: lang,
				...(body.inputVideoPath ? { inputVideoPath: body.inputVideoPath } : {}),
				...(body.inputVideoUrl ? { inputVideoUrl: body.inputVideoUrl } : {}),
				...(body.outputDir ? { outputDir: body.outputDir } : {}),
				...(body.apiKey ? { apiKey: body.apiKey } : {}),
			};
			const { dubbingId, audioUrl, videoUrl } = await dubVideoWithElevenLabs(reqObj);

			// 서비스에서 반환된 temp URL → 최종 경로로 이동
			const tempUrl = audioUrl ?? videoUrl ?? "";
			const tempKey = tempUrl.replace(/^https?:\/\/[^/]+\//, "");
			const finalKey = `assets/curriculumsection/${body.curriculumSectionId ?? video.id}/${audioUrl ? `audio/${lang}/${video.id}.mp3` : `dub/${lang}/${video.id}.mp4`}`;
			const { key, url } = await copyObjectInS3(tempKey, finalKey, {
				cacheControl: "public, max-age=31536000, immutable",
				contentType: audioUrl ? "audio/mpeg" : "video/mp4",
			});

			// DubTrack upsert (videoId+lang unique)
			await prisma.dubTrack.upsert({
				where: { videoId_lang: { videoId: video.id, lang } },
				update: { status: "ready", url, updatedAt: new Date() },
				create: { videoId: video.id, lang, status: "ready", url, updatedAt: new Date() },
			});

			results.push({ lang, dubbingId, outputKey: key, url });
		}

		// HLS 자동 패키징 (비디오 1회, 오디오는 언어별)
		const sectionId = body.curriculumSectionId ?? video.id;
		const basePrefix = `assets/curriculumsection/${sectionId}/`;
		const videoM3u8Key = `${basePrefix}video/video.m3u8`;
		const needVideo = !(await objectExistsInS3(videoM3u8Key));
		const tmpRoot = path.resolve(os.tmpdir(), `section-${sectionId}-${Date.now()}`);
		await fs.mkdir(tmpRoot, { recursive: true });

		if (needVideo) {
			const videoDir = path.join(tmpRoot, "video");
			await fs.mkdir(videoDir, { recursive: true });
			await execa("ffmpeg", [
				"-y","-i", body.inputVideoPath ?? body.inputVideoUrl!,"-map","0:v:0","-c:v","libx264","-profile:v","main",
				"-level","4.1","-preset","veryfast","-crf","20","-x264-params","keyint=48:min-keyint=48:scenecut=0","-start_number","0",
				"-hls_time","4","-hls_playlist_type","vod","-hls_segment_type","fmp4","-hls_flags","independent_segments",
				"-hls_segment_filename", path.join(videoDir, "v_%03d.m4s"), path.join(videoDir, "video.m3u8")
			], { stdio: "inherit" });
			await upsertMasterPlaylist({ masterPath: path.join(tmpRoot, "master.m3u8"), videoM3u8Rel: "video/video.m3u8", audioEntries: [] });
			await uploadDirToS3(tmpRoot, basePrefix);
		}

		// 언어별 오디오 HLS 패키징 + master 갱신
		for (const lang of body.targetLanguages) {
			const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;
			const exists = await objectExistsInS3(audioM3u8Key);
			if (exists) continue;
			const outDir = path.join(tmpRoot, "audio", lang);
			await fs.mkdir(outDir, { recursive: true });
			// 더빙 mp3 URL 재사용
			const track = await prisma.dubTrack.findUnique({ where: { videoId_lang: { videoId: video.id, lang } } });
			if (!track?.url) continue;
			const aligned = path.join(outDir, "aligned.wav");
			await execa("ffmpeg", ["-y","-i", track.url, "-af","loudnorm=I=-16:LRA=11:TP=-1.5", "-ar","48000","-ac","2", aligned], { stdio: "inherit" });
			await execa("ffmpeg", [
				"-y","-i", aligned, "-c:a","aac","-b:a","128k","-ar","48000","-start_number","0","-hls_time","4",
				"-hls_playlist_type","vod","-hls_segment_type","fmp4","-hls_flags","independent_segments","-hls_segment_filename", path.join(outDir, "a_%03d.m4s"), path.join(outDir, "audio.m3u8")
			], { stdio: "inherit" });
			await patchMasterAddAudio({ masterPath: path.join(tmpRoot, "master.m3u8"), lang, name: lang, uri: `audio/${lang}/audio.m3u8`, groupId: "aud" });
		}
		await uploadDirToS3(tmpRoot, basePrefix);
		await fs.rm(tmpRoot, { recursive: true, force: true });

		res.json({ ok: true, videoId: video.id, results });
	} catch (err) {
		next(err);
	}
});


