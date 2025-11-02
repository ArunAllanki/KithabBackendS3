// utils/s3.js
import AWS from "aws-sdk";
import dotenv from "dotenv";
dotenv.config();

const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME } =
  process.env;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_REGION) {
  throw new Error(
    "AWS credentials or region missing. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION in your .env"
  );
}

if (!S3_BUCKET_NAME) {
  throw new Error("S3_BUCKET_NAME is not set in .env");
}

AWS.config.update({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
});

const s3 = new AWS.S3();
const BUCKET = S3_BUCKET_NAME;

// ===== Single file helpers =====

export const getUploadURL = async (fileKey, fileType, expiresSec = 3600) => {
  const params = {
    Bucket: BUCKET,
    Key: fileKey,
    ContentType: fileType,
    Expires: expiresSec,
  };
  return s3.getSignedUrlPromise("putObject", params);
};

export const getDownloadURL = async (fileKey, expiresSec = 3600) => {
  const params = { Bucket: BUCKET, Key: fileKey, Expires: expiresSec };
  return s3.getSignedUrlPromise("getObject", params);
};

// ✅ Both names exported for compatibility
export const deleteS3Object = async (fileKey) => {
  return s3.deleteObject({ Bucket: BUCKET, Key: fileKey }).promise();
};
export const deleteFile = deleteS3Object; // alias for backward compatibility

// ===== Multiple file helpers =====

export const getUploadURLs = async (files) => {
  if (!Array.isArray(files)) throw new Error("files must be an array");
  return Promise.all(
    files.map(({ fileKey, fileType }) => getUploadURL(fileKey, fileType))
  );
};

export const getDownloadURLs = async (fileKeys) => {
  if (!Array.isArray(fileKeys)) throw new Error("fileKeys must be an array");
  return Promise.all(fileKeys.map((k) => getDownloadURL(k)));
};

export const deleteFiles = async (fileKeys) => {
  if (!Array.isArray(fileKeys)) throw new Error("fileKeys must be an array");
  return Promise.all(fileKeys.map((key) => deleteS3Object(key)));
};

export default s3;
