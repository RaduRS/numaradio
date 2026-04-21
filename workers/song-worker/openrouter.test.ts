import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPngBase64, type OpenRouterImageResponse } from "./openrouter.ts";

test("extractPngBase64 reads choices[0].message.images[0].image_url.url data-uri", () => {
  const resp: OpenRouterImageResponse = {
    choices: [
      {
        message: {
          images: [
            {
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
              },
            },
          ],
        },
      },
    ],
  };
  assert.equal(extractPngBase64(resp), "iVBORw0KGgoAAAANSUhEUgAA");
});

test("extractPngBase64 reads bare base64 in content when message.images absent", () => {
  const longBase64 = "iVBORw0KGgoAAAANSUhEUgAA" + "A".repeat(300);
  const resp: OpenRouterImageResponse = {
    choices: [
      {
        message: {
          content: longBase64,
        },
      },
    ],
  };
  assert.equal(extractPngBase64(resp), longBase64);
});

test("extractPngBase64 returns null when neither path yields base64", () => {
  const resp: OpenRouterImageResponse = { choices: [{ message: { content: "" } }] };
  assert.equal(extractPngBase64(resp), null);
});
