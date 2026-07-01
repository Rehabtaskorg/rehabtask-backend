import { Storage } from "@google-cloud/storage";
import { env } from "./env.js";

export const gcs = new Storage({ projectId: env.GCP_PROJECT_ID });