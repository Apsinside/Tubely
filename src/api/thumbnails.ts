import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if(!(file instanceof File)){
    throw new BadRequestError("Uploaded image is not a valid file");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if(file.size > MAX_UPLOAD_SIZE ){
    throw new BadRequestError("Maximum file size of 10MB exceeded");
  }

  const mediaType = file.type;
  const data = await file.arrayBuffer();
  
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if(video?.userID !== userID){
    throw new UserForbiddenError("Video does not belong to user");
  }

  const fileExtension = getFileExtension(mediaType);
  const filePath = path.join(cfg.assetsRoot, videoId) + "." + fileExtension;
  const bytesWritten = await Bun.write(filePath, data);
  // if(bytesWritten !== file.size){
  //   throw new Error(`Failed to store video thumbnail file at ${filePath}`)
  // }
  console.log("Uploaded thumbnail for video", videoId, "stored at", filePath);

  video.thumbnailURL = `http://localhost:8091/assets/${videoId}.${fileExtension}`;

  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}


function getFileExtension(mediaType: string): string{
  switch(mediaType){
    case ("image/png"):
      return "png";
    case ("application/json"):
      return "json";
    case ("text/html"):
      return "html";
    default:
      return "";
  }

}