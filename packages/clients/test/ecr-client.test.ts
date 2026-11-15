import { BatchGetImageCommand, DescribeImagesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { mockClient } from "aws-sdk-client-mock";
import { EcrClient } from "../src";

const ecr = mockClient(ECRClient);
beforeEach(() => ecr.reset());

describe("EcrClient", () => {
  test("describeImages follows all pages", async () => {
    ecr
      .on(DescribeImagesCommand)
      .resolvesOnce({ imageDetails: [{ imageDigest: "sha256:a" }], nextToken: "t1" })
      .resolvesOnce({ imageDetails: [{ imageDigest: "sha256:b" }] });

    const images = await new EcrClient().describeImages("backend", [{ imageTag: "v1" }]);

    expect(images.map((i) => i.imageDigest)).toEqual(["sha256:a", "sha256:b"]);
    expect(ecr.commandCalls(DescribeImagesCommand)).toHaveLength(2);
    expect(ecr.commandCalls(DescribeImagesCommand)[0].args[0].input).toMatchObject({
      repositoryName: "backend",
      imageIds: [{ imageTag: "v1" }],
    });
    expect(ecr.commandCalls(DescribeImagesCommand)[1].args[0].input).toMatchObject({
      nextToken: "t1",
    });
  });

  test("batchGetImage returns images and failures", async () => {
    ecr.on(BatchGetImageCommand).resolves({
      images: [{ imageId: { imageTag: "v1", imageDigest: "sha256:a" } }],
      failures: [{ imageId: { imageTag: "missing" }, failureCode: "ImageTagDoesNotMatchDigest" }],
    });

    const result = await new EcrClient().batchGetImage("backend", [
      { imageTag: "v1" },
      { imageTag: "missing" },
    ]);

    expect(result.images[0].imageId?.imageDigest).toBe("sha256:a");
    expect(result.failures[0].imageId?.imageTag).toBe("missing");
    expect(ecr.commandCalls(BatchGetImageCommand)[0].args[0].input).toEqual({
      repositoryName: "backend",
      imageIds: [{ imageTag: "v1" }, { imageTag: "missing" }],
    });
  });

  test("batchGetImage defaults missing arrays to empty", async () => {
    ecr.on(BatchGetImageCommand).resolves({});

    await expect(new EcrClient().batchGetImage("backend", [{ imageTag: "v1" }])).resolves.toEqual({
      images: [],
      failures: [],
    });
  });
});
