import { CloudFrontClient, CreateInvalidationCommand, type CloudFrontClientConfig } from "@aws-sdk/client-cloudfront";
import { env } from "./env.js";

const cloudfrontConfig: CloudFrontClientConfig = {
    region: "us-east-1",
    ...(env.AWS_ACCESS_KEY && env.AWS_SECRET_KEY && {
        credentials: {
            accessKeyId: env.AWS_ACCESS_KEY,
            secretAccessKey: env.AWS_SECRET_KEY,
        }
    })
};

const cloudfront = new CloudFrontClient(cloudfrontConfig);

export async function invalidatePaths(paths: string[]): Promise<void> {
    if (!env.CLOUDFRONT_DISTRIBUTION_ID) {
        console.warn("CLOUDFRONT_DISTRIBUTION_ID not configured, skipping invalidation");
        return;
    }

    const CallerReference = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
        await cloudfront.send(new CreateInvalidationCommand({
            DistributionId: env.CLOUDFRONT_DISTRIBUTION_ID,
            InvalidationBatch: {
                CallerReference,
                Paths: {
                    Quantity: paths.length,
                    Items: paths,
                },
            },
        }));
    } catch (error) {
        console.error("CloudFront invalidation failed:", error);
        throw error;
    }
}

export async function invalidateMaster(sectionId: number | string): Promise<void> {
    const path = `/assets/curriculumsection/${sectionId}/master.m3u8`;
    return invalidatePaths([path]);
}