import OpenAI from "openai";

export const KAKAO_CAPTURE_PARSER_MODEL =
  process.env.OPENAI_KAKAO_CAPTURE_MODEL ||
  process.env.OPENAI_ANALYSIS_MODEL ||
  "gpt-5.1";

const DEFAULT_MIME_TYPE = "image/png";
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function toImageDataUrl({
  imageBase64,
  imageDataUrl,
  mimeType = DEFAULT_MIME_TYPE,
} = {}) {
  if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/")) {
    return imageDataUrl;
  }

  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    return null;
  }

  const normalizedMimeType = ALLOWED_MIME_TYPES.has(mimeType)
    ? mimeType
    : DEFAULT_MIME_TYPE;

  return `data:${normalizedMimeType};base64,${imageBase64.trim()}`;
}

export function normalizeImageInputs({ images, imageBase64, imageDataUrl, mimeType } = {}) {
  const imageInputs = Array.isArray(images)
    ? images
    : [{ imageBase64, imageDataUrl, mimeType }];

  return imageInputs
    .map((image) => toImageDataUrl(image))
    .filter(Boolean);
}

export function parseJsonContent(content) {
  const trimmed = (content || "").trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(unfenced);
}

export function normalizeKakaoMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message, index) => ({
      order:
        Number.isInteger(message.order) && message.order > 0
          ? message.order
          : index + 1,
      speaker: message.speaker === "B" ? "B" : "A",
      text: typeof message.text === "string" ? message.text.trim() : "",
      time: typeof message.time === "string" ? message.time.trim() : null,
    }))
    .filter((message) => message.text.length > 0)
    .sort((left, right) => left.order - right.order)
    .map((message, index) => ({
      ...message,
      order: index + 1,
    }));
}

export function buildSpeakerRawTexts(messages) {
  return {
    A: messages
      .filter((message) => message.speaker === "A")
      .map((message) => message.text)
      .join("\n"),
    B: messages
      .filter((message) => message.speaker === "B")
      .map((message) => message.text)
      .join("\n"),
  };
}

export function buildCombinedConversation(messages) {
  return messages
    .map((message) => `${message.speaker}: ${message.text}`)
    .join("\n");
}

function createDefaultOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export async function parseKakaoCaptureImage({
  imageBase64,
  imageDataUrl,
  mimeType,
  images,
  client = createDefaultOpenAIClient(),
  model = KAKAO_CAPTURE_PARSER_MODEL,
} = {}) {
  const dataUrls = normalizeImageInputs({
    images,
    imageBase64,
    imageDataUrl,
    mimeType,
  });

  if (!dataUrls.length) {
    const error = new Error("KAKAO_CAPTURE_IMAGE_REQUIRED");
    error.code = "KAKAO_CAPTURE_IMAGE_REQUIRED";
    throw error;
  }

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a precise OCR parser for KakaoTalk conflict-chat screenshots.",
          "Extract only real chat bubbles. Ignore status bars, date dividers, timestamps when they are not message text, read receipts, ads, and app UI.",
          "Use speaker A for right-side bubbles and speaker B for left-side bubbles.",
          "Preserve chronological order. Return JSON only.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              'The user may provide multiple screenshots. Read them in the same order they appear here, then merge them into one chronological conversation. Return this exact shape: {"messages":[{"order":1,"speaker":"A","text":"message text","time":null}],"notes":["short extraction notes"]}. Use speaker only as "A" or "B".',
          },
          ...dataUrls.map((url) => ({
            type: "image_url",
            image_url: {
              url,
              detail: "high",
            },
          })),
        ],
      },
    ],
  });

  const parsed = parseJsonContent(response.choices?.[0]?.message?.content);
  const messages = normalizeKakaoMessages(parsed.messages);
  const rawTexts = buildSpeakerRawTexts(messages);

  return {
    model,
    imageCount: dataUrls.length,
    messages,
    rawTexts,
    combinedText: buildCombinedConversation(messages),
    notes: Array.isArray(parsed.notes) ? parsed.notes.filter(Boolean) : [],
    summary: {
      messageCount: messages.length,
      aMessageCount: messages.filter((message) => message.speaker === "A").length,
      bMessageCount: messages.filter((message) => message.speaker === "B").length,
      hasBothSpeakers: Boolean(rawTexts.A && rawTexts.B),
    },
  };
}

export async function parseKakaoCaptureImages(options = {}) {
  return parseKakaoCaptureImage(options);
}
