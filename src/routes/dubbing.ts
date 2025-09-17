import { Router } from "express";
import type { Router as ExpressRouter, Request } from "express";
import { dubVideoWithElevenLabs, type DubbingRequest } from "../services/dubbing.js";
import type { DubbingLanguageCode } from "../lib/elevenlabs.js";
import { prisma } from "../lib/prisma.js";
import { objectExistsInS3 } from "../lib/s3.js";
import { downloadToFile } from "../lib/s3-download.js";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { uploadDirToS3 } from "../lib/s3-upload-dir.js";
import { upsertMasterPlaylist } from "../lib/media/hls-master.js";

export const router: ExpressRouter = Router();

interface BodyShape {
	inputVideoPath?: string;
	inputVideoUrl?: string;
	targetLanguages: DubbingLanguageCode[];
	sourceLanguage?: string;
	curriculumSectionId?: number;
}

router.post("/", async (req: Request<never, unknown, BodyShape>, res, next) => {
	const body = req.body;
	console.log("[Dubbing] Request received:", JSON.stringify(body, null, 2));

	if (!body.inputVideoPath && !body.inputVideoUrl) {
		console.error("[Dubbing] Missing video URL/path");
		res.status(400).json({ error: "inputVideoPath 또는 inputVideoUrl 중 하나가 필요합니다" });
		return;
	}
	if (!body.targetLanguages || body.targetLanguages.length === 0) {
		res.status(400).json({ error: "No target languages specified" });
		return;
	}

	try {
		// 1) Find or create Video record
		let video = null;

		// Only search if curriculumSectionId is provided
		if (body.curriculumSectionId !== undefined && body.curriculumSectionId !== null) {
			video = await prisma.video.findFirst({
				where: { curriculumSectionId: body.curriculumSectionId },
				include: { DubTrack: true }
			});
		}

		if (!video) {
			if (!body.curriculumSectionId) {
				res.status(400).json({ error: "curriculumSectionId required for new video" });
				return;
			}
			video = await prisma.video.create({
				data: {
					curriculumSectionId: body.curriculumSectionId,
					videoUrl: body.inputVideoUrl || "",
					title: "Dubbed Video",
					masterKey: `assets/curriculumsection/${body.curriculumSectionId}/master.m3u8`,
					updatedAt: new Date(),
				},
				include: { DubTrack: true }
			});
		}

		// Check which languages are already done
		const existingLangs = video.DubTrack.map(t => t.lang);
		const newLangs = body.targetLanguages.filter(l => !existingLangs.includes(l));

		console.log("[Dubbing] Existing languages:", existingLangs);
		console.log("[Dubbing] New languages to process:", newLangs);

		if (newLangs.length === 0) {
			return res.json({
				ok: true,
				videoId: video.id,
				message: "All requested languages already exist",
				results: video.DubTrack.map(t => ({
					lang: t.lang,
					url: t.url
				}))
			});
		}

		const results: Array<{ lang: string; url: string }> = [];

		// 2) Process each language separately
		for (const lang of newLangs) {
			console.log(`[Dubbing] Processing ${lang}...`);

			try {
				// Call ElevenLabs for this language
				const dubbingReq: DubbingRequest = {
					inputVideoPath: body.inputVideoPath,
					inputVideoUrl: body.inputVideoUrl,
					targetLanguage: lang,
				};

				console.log(`[Dubbing] Calling ElevenLabs for ${lang}...`);
				const dubbingResult = await dubVideoWithElevenLabs(dubbingReq);

				console.log(`[Dubbing] ${lang} completed:`, dubbingResult);

				// Get the final URL
				const finalUrl = dubbingResult.audioUrl || dubbingResult.videoUrl;
				if (!finalUrl) {
					console.error(`[Dubbing] No URL returned for ${lang}`);
					continue;
				}

				// Save to database
				await prisma.dubTrack.upsert({
					where: { videoId_lang: { videoId: video.id, lang } },
					update: { status: "ready", url: finalUrl, updatedAt: new Date() },
					create: { videoId: video.id, lang, status: "ready", url: finalUrl, updatedAt: new Date() },
				});

				results.push({ lang, url: finalUrl });
				console.log(`[Dubbing] ${lang} saved to database`);

			} catch (err) {
				console.error(`[Dubbing] Failed to process ${lang}:`, err);
				// Continue with next language instead of failing completely
			}
		}

		// 3) HLS packaging
		const sectionId = body.curriculumSectionId ?? video.id;
		const basePrefix = `assets/curriculumsection/${sectionId}/`;
		const videoM3u8Key = `${basePrefix}video/video.m3u8`;
		const masterM3u8Key = `${basePrefix}master.m3u8`;
		const tmpRoot = path.resolve(os.tmpdir(), `section-${sectionId}-${Date.now()}`);
		await fs.mkdir(tmpRoot, { recursive: true });

		console.log(`[HLS] Processing section ${sectionId}`);

		// Download existing master.m3u8 if it exists
		const masterPath = path.join(tmpRoot, "master.m3u8");
		if (await objectExistsInS3(masterM3u8Key)) {
			try {
				await downloadToFile(masterM3u8Key, masterPath);
				console.log(`[HLS] Downloaded existing master.m3u8 from S3`);
			} catch (err) {
				console.error(`[HLS] Failed to download master.m3u8: ${err}`);
			}
		}

		// Generate video HLS if needed
		if (true) { // TEMP: Force regenerate video
			console.log("[HLS] Generating video HLS...");
			const videoDir = path.join(tmpRoot, "video");
			await fs.mkdir(videoDir, { recursive: true });

			// Generate HLS with init.mp4
			await execa("ffmpeg", [
				"-y",
				"-i", body.inputVideoPath ?? body.inputVideoUrl!,
				"-map", "0:v:0",
				"-c:v", "libx264",
				"-profile:v", "main",
				"-level", "4.1",
				"-preset", "veryfast",
				"-crf", "23",
				"-x264-params", "keyint=48:min-keyint=48:scenecut=0",
				"-start_number", "0",
				"-hls_time", "4",
				"-hls_playlist_type", "vod",
				"-hls_segment_type", "fmp4",
				"-hls_fmp4_init_filename", "init.mp4",
				"-hls_flags", "independent_segments",
				"-hls_segment_filename", "v_%03d.m4s",
				"video.m3u8"
			], { stdio: "inherit", cwd: videoDir });

			console.log("[HLS] Video HLS generated");

			// List generated video files to confirm init.mp4
			const videoFiles = await fs.readdir(videoDir);
			console.log("[HLS] Video files generated:", videoFiles);

			// Verify init.mp4 exists
			const hasInit = videoFiles.includes("init.mp4");
			if (!hasInit) {
				console.error("[HLS] WARNING: init.mp4 not found in video directory!");
			} else {
				console.log("[HLS] init.mp4 successfully created in video directory");
			}

			// FIXED: Get all existing ready tracks for initial master playlist
			const initialReadyTracks = await prisma.dubTrack.findMany({
				where: { videoId: video.id, status: "ready" },
				orderBy: { lang: 'asc' }
			});

			const initialAudioEntries = initialReadyTracks.map(track => ({
				lang: track.lang,
				name: track.lang,
				uri: `audio/${track.lang}/audio.m3u8`,
				groupId: "aud",
				defaultFlag: track.lang === "ja" || track.lang === "ko"
			}));

			console.log("[HLS] Initial master playlist with existing tracks:", initialAudioEntries);

			await upsertMasterPlaylist({
				masterPath,
				videoM3u8Rel: "video/video.m3u8",
				audioEntries: initialAudioEntries
			});
		}

		// Generate audio HLS for each language
		for (const lang of body.targetLanguages) {
			const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;
			if (await objectExistsInS3(audioM3u8Key)) {
				console.log(`[HLS] Audio for ${lang} already exists, skipping`);
				continue;
			}

			const track = await prisma.dubTrack.findUnique({
				where: { videoId_lang: { videoId: video.id, lang } }
			});
			if (!track?.url) {
				console.error(`[HLS] No track URL for ${lang}`);
				continue;
			}

			console.log(`[HLS] Generating audio HLS for ${lang}...`);
			const audioDir = path.join(tmpRoot, "audio", lang);
			await fs.mkdir(audioDir, { recursive: true });

			// Normalize audio first
			const aligned = path.join(audioDir, "aligned.wav");
			await execa("ffmpeg", [
				"-y",
				"-i", track.url,
				"-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
				"-ar", "48000",
				"-ac", "2",
				aligned
			], { stdio: "inherit" });

			// Generate HLS with init.mp4
			await execa("ffmpeg", [
				"-y",
				"-i", aligned,
				"-c:a", "aac",
				"-b:a", "128k",
				"-ar", "48000",
				"-start_number", "0",
				"-hls_time", "4",
				"-hls_playlist_type", "vod",
				"-hls_segment_type", "fmp4",
				"-hls_fmp4_init_filename", "init.mp4",
				"-hls_flags", "independent_segments",
				"-hls_segment_filename", "a_%03d.m4s",
				"audio.m3u8"
			], { stdio: "inherit", cwd: audioDir });

			console.log(`[HLS] Audio HLS for ${lang} generated`);

			// Verify init.mp4 exists in audio directory
			const audioFiles = await fs.readdir(audioDir);
			const hasAudioInit = audioFiles.includes("init.mp4");
			if (!hasAudioInit) {
				console.error(`[HLS] WARNING: init.mp4 not found in audio/${lang} directory!`);
			}
		}

		// FIXED: After all audio processing, regenerate master playlist with ALL languages from DB
		console.log("[HLS] Regenerating master playlist with all dub tracks from DB...");

		const allFinalTracks = await prisma.dubTrack.findMany({
			where: { videoId: video.id, status: "ready" },
			orderBy: { lang: 'asc' }
		});

		const finalAudioEntries = allFinalTracks.map(track => ({
			lang: track.lang,
			name: track.lang,
			uri: `audio/${track.lang}/audio.m3u8`,
			groupId: "aud",
			defaultFlag: track.lang === "ja" || track.lang === "ko" // Japanese or Korean as default
		}));

		console.log("[HLS] Final master playlist audio entries:", finalAudioEntries);

		// Regenerate master playlist with all languages
		await upsertMasterPlaylist({
			masterPath,
			videoM3u8Rel: "video/video.m3u8",
			audioEntries: finalAudioEntries
		});

		console.log("[HLS] Master playlist regenerated with all languages");

		// Upload everything to S3
		console.log("[HLS] Uploading to S3...");
		await uploadDirToS3(tmpRoot, basePrefix);
		console.log("[HLS] Upload complete");

		// Cleanup
		await fs.rm(tmpRoot, { recursive: true, force: true });

		const masterUrl = `${process.env.NEXT_PUBLIC_CDN_URL || "https://storage.lingoost.com"}/${basePrefix}master.m3u8`;
		console.log("[Dubbing] Complete! Master URL:", masterUrl);

		res.json({
			ok: true,
			videoId: video.id,
			results,
			masterUrl
		});
	} catch (err) {
		console.error("[Dubbing] Error:", err);
		next(err);
	}
});

export default router;