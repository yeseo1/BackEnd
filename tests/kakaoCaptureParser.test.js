import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCombinedConversation,
  buildSpeakerRawTexts,
  normalizeImageInputs,
  normalizeKakaoMessages,
  parseKakaoCaptureImages,
} from "../utils/kakaoCaptureParser.js";

test("여러 이미지 입력을 data URL 목록으로 정규화한다", () => {
  const images = normalizeImageInputs({
    images: [
      { mimeType: "image/png", imageBase64: "aaa" },
      { imageDataUrl: "data:image/jpeg;base64,bbb" },
      { imageBase64: "" },
    ],
  });

  assert.deepEqual(images, [
    "data:image/png;base64,aaa",
    "data:image/jpeg;base64,bbb",
  ]);
});

test("카카오톡 메시지를 시간순 A/B 원문으로 변환한다", () => {
  const messages = normalizeKakaoMessages([
    { order: 2, speaker: "B", text: "왜 답이 늦었어?" },
    { order: 1, speaker: "A", text: "미안 회의 중이었어" },
    { order: 3, speaker: "C", text: "다음엔 미리 말할게" },
  ]);

  assert.deepEqual(messages.map((message) => message.speaker), ["A", "B", "A"]);
  assert.deepEqual(buildSpeakerRawTexts(messages), {
    A: "미안 회의 중이었어\n다음엔 미리 말할게",
    B: "왜 답이 늦었어?",
  });
  assert.equal(
    buildCombinedConversation(messages),
    "A: 미안 회의 중이었어\nB: 왜 답이 늦었어?\nA: 다음엔 미리 말할게",
  );
});

test("parses Google Vision paragraphs into A/B Kakao messages", async () => {
  const paragraph = ({ text, minX, maxX, minY, maxY }) => ({
    boundingBox: {
      vertices: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    },
    words: text.split(" ").map((word) => ({
      symbols: [...word].map((char) => ({ text: char })),
    })),
  });

  const visionClient = {
    async documentTextDetection() {
      return [
        {
          fullTextAnnotation: {
            text: "2026년 6월 7일\n오후 3:41\nJisu\nhello\nsorry\n카카오톡",
            pages: [
              {
                width: 1000,
                height: 1200,
                blocks: [
                  {
                    paragraphs: [
                      paragraph({
                        text: "2026년 6월 7일",
                        minX: 380,
                        maxX: 620,
                        minY: 40,
                        maxY: 70,
                      }),
                      paragraph({
                        text: "오후 3:41",
                        minX: 440,
                        maxX: 560,
                        minY: 82,
                        maxY: 108,
                      }),
                      paragraph({
                        text: "Jisu",
                        minX: 90,
                        maxX: 145,
                        minY: 112,
                        maxY: 132,
                      }),
                      paragraph({
                        text: "hello",
                        minX: 80,
                        maxX: 320,
                        minY: 150,
                        maxY: 190,
                      }),
                      paragraph({
                        text: "sorry",
                        minX: 680,
                        maxX: 920,
                        minY: 260,
                        maxY: 300,
                      }),
                      paragraph({
                        text: "카카오톡",
                        minX: 20,
                        maxX: 70,
                        minY: 500,
                        maxY: 530,
                      }),
                    ],
                  },
                ],
              },
            ],
          },
        },
      ];
    },
  };

  const parsed = await parseKakaoCaptureImages({
    imageBase64: "aaa",
    visionClient,
  });

  assert.deepEqual(
    parsed.messages.map((message) => [message.speaker, message.text]),
    [
      ["B", "hello"],
      ["A", "sorry"],
    ],
  );
  assert.equal(parsed.model, "google-cloud-vision/document-text-detection");
});
