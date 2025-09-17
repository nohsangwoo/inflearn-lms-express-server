import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "path";
import { execa } from "execa";

// S3 client setup
const s3 = new S3Client({
  region: "ap-northeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

async function generateAndUploadInitMp4() {
  const languages = ["ja", "zh", "en"];
  const sectionId = 3;
  const bucketName = "lingoost-origin";

  for (const lang of languages) {
    const audioUrl = `https://storage.lingoost.com/assets/temp/dubbed-audio/download.${
      lang === "ja" ? "1758135066329" :
      lang === "zh" ? "1758135325004" :
      "1758135508168"
    }.dub.${lang}.mp3`;

    const tempDir = `c:/temp/audio-${lang}`;
    await fs.mkdir(tempDir, { recursive: true });

    console.log(`Processing ${lang}...`);

    // Download the MP3 file
    const mp3Path = path.join(tempDir, "audio.mp3");
    await execa("curl", ["-o", mp3Path, audioUrl]);

    // Convert MP3 to fMP4 format with init.mp4
    await execa("ffmpeg", [
      "-y",
      "-i", "audio.mp3",
      "-c:a", "aac",
      "-b:a", "128k",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", "a_%03d.m4s",
      "audio.m3u8"
    ], { cwd: tempDir, stdio: "inherit" });

    // Upload init.mp4 to S3
    const initPath = path.join(tempDir, "init.mp4");
    const initData = await fs.readFile(initPath);
    const s3Key = `assets/curriculumsection/${sectionId}/audio/${lang}/init.mp4`;

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: initData,
      ContentType: "video/mp4",
    }));

    console.log(`Uploaded init.mp4 for ${lang} to s3://${bucketName}/${s3Key}`);
  }

  console.log("All init.mp4 files uploaded successfully!");
}

generateAndUploadInitMp4().catch(console.error);