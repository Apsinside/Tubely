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

  const s3File = cfg.s3Client.file(filePath, { type: mediaType });
  await s3File.write(Bun.file(tempFilePath));

  await Bun.file(tempFilePath).delete()

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${filePath}`;
  console.log("Uploaded video", videoId, "stored at", video.videoURL);

  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
