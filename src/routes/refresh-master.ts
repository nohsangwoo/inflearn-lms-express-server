import { Router } from "express";
import type { Router as ExpressRouter, Request } from "express";
import { refreshMasterPlaylist } from "../lib/media/db-based-master.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { uploadDirToS3 } from "../lib/s3-upload-dir.js";

export const router: ExpressRouter = Router();

interface RefreshBodyShape {
	sectionId: number;
}

/**
 * POST /api/refresh-master
 * Refresh master.m3u8 file based on current DB DubTrack data
 */
router.post("/", async (req: Request<never, unknown, RefreshBodyShape>, res, next) => {
	const { sectionId } = req.body;

	console.log("[RefreshMaster] Request received for section:", sectionId);

	if (!sectionId || typeof sectionId !== 'number') {
		res.status(400).json({ error: "sectionId is required and must be a number" });
		return;
	}

	try {
		// Create temporary directory
		const tmpRoot = path.resolve(os.tmpdir(), `refresh-master-${sectionId}-${Date.now()}`);
		await fs.mkdir(tmpRoot, { recursive: true });

		const masterPath = path.join(tmpRoot, "master.m3u8");
		const basePrefix = `assets/curriculumsection/${sectionId}/`;

		console.log("[RefreshMaster] Generating master playlist from DB...");

		// Generate master playlist based on current DB data
		await refreshMasterPlaylist({
			sectionId,
			masterPath
		});

		console.log("[RefreshMaster] Master playlist generated, uploading to S3...");

		// Upload only the master.m3u8 file to S3
		await uploadDirToS3(tmpRoot, basePrefix);

		console.log("[RefreshMaster] Upload complete");

		// Cleanup
		await fs.rm(tmpRoot, { recursive: true, force: true });

		const masterUrl = `${process.env.NEXT_PUBLIC_CDN_URL || "https://storage.lingoost.com"}/${basePrefix}master.m3u8`;

		res.json({
			ok: true,
			message: "Master playlist refreshed successfully",
			masterUrl,
			sectionId
		});

	} catch (err) {
		console.error("[RefreshMaster] Error:", err);
		next(err);
	}
});

export default router;