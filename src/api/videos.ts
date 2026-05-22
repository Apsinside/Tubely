import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getFileExtension } from "./thumbnails";
import path from "path";
import { randomBytes } from "crypto";
import { createGunzip } from "zlib";
import { getTsBuildInfoEmitOutputFilePath } from "typescript";
import { json } from "stream/consumers";
import { log } from "console";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  req.headers
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video?.userID !== userID) {
    throw new UserForbiddenError("Video does not belong to user");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Uploaded video is not a valid file");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Maximum file size of 10MB exceeded");
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Uploaded video is not a valid file");
  }


  const data = await file.arrayBuffer();

  const fileExtension = getFileExtension(mediaType);
  const filename = randomBytes(32).toString("base64url");
  const filePath = filename + "." + fileExtension;

  const tempFilePath = path.join(cfg.assetsRoot, filePath);

  await Bun.write(tempFilePath, data);
  const aspectRatio = await getVideoAspectRatio(tempFilePath);

  const s3FilePath = `${aspectRatio}/${filePath}`
  const s3File = cfg.s3Client.file(s3FilePath, { type: mediaType });

  await s3File.write(Bun.file(tempFilePath));
  await Bun.file(tempFilePath).delete()

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3FilePath}`;
  console.log("Uploaded video", videoId, "stored at", video.videoURL);

  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}


async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath],
    stdout: "pipe",
    stderr: "pipe"
  });
  const exitCode = await proc.exited;
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    throw new BadRequestError("ffprobe failed with " + stderrText);
  }

  const json = await JSON.parse(stdoutText);
  const width = json["streams"][0]["width"];
  const height = json["streams"][0]["height"];

  const aspectRatio = Math.floor(width / height);

  if (aspectRatio === 1) {
    return "landscape";;
  } else if (aspectRatio < 1) {
    return "portrait";
  }

  return "other";
}