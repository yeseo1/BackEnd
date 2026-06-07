import vision from "@google-cloud/vision";

export const KAKAO_CAPTURE_PARSER_MODEL =
  process.env.GOOGLE_VISION_OCR_MODEL ||
  "google-cloud-vision/document-text-detection";

const DEFAULT_MIME_TYPE = "image/png";
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SAME_MESSAGE_VERTICAL_GAP_PX = Number(
  process.env.KAKAO_CAPTURE_MESSAGE_GAP_PX || 28,
);
const CHAT_CONTENT_HORIZONTAL_PADDING_RATIO = Number(
  process.env.KAKAO_CAPTURE_CONTENT_HORIZONTAL_PADDING_RATIO || 0.08,
);
const SENDER_NAME_LABEL_MAX_LENGTH = Number(
  process.env.KAKAO_CAPTURE_SENDER_NAME_LABEL_MAX_LENGTH || 20,
);
const SENDER_NAME_LABEL_MAX_GAP_PX = Number(
  process.env.KAKAO_CAPTURE_SENDER_NAME_LABEL_MAX_GAP_PX || 42,
);
const GOOGLE_VISION_CONFIG_MESSAGE =
  "Google Vision OCR credentials are not configured.";
const NON_MESSAGE_TEXT_PATTERNS = [
  /^(오전|오후)\s*\d{1,2}:\d{2}$/u,
  /^\d{1,2}:\d{2}\s*(AM|PM)?$/iu,
  /^\d{4}[년.\-/]\s*\d{1,2}[월.\-/]\s*\d{1,2}일?\.?$/u,
  /^\d{1,2}월\s*\d{1,2}일/u,
  /^(월|화|수|목|금|토|일)요일$/u,
  /^읽음\s*\d*$/u,
  /^안읽음\s*\d*$/u,
  /^카카오톡$/u,
];

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

function parseImageDataUrl(imageDataUrl) {
  if (typeof imageDataUrl !== "string") return null;

  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const [, mimeType, imageBase64] = match;

  return {
    imageBase64,
    mimeType: ALLOWED_MIME_TYPES.has(mimeType) ? mimeType : DEFAULT_MIME_TYPE,
  };
}

export function toVisionImageInput({
  imageBase64,
  imageDataUrl,
  mimeType = DEFAULT_MIME_TYPE,
} = {}) {
  const parsedDataUrl = parseImageDataUrl(imageDataUrl);

  if (parsedDataUrl) {
    return parsedDataUrl;
  }

  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    return null;
  }

  return {
    imageBase64: imageBase64.trim(),
    mimeType: ALLOWED_MIME_TYPES.has(mimeType) ? mimeType : DEFAULT_MIME_TYPE,
  };
}

export function normalizeVisionImageInputs({
  images,
  imageBase64,
  imageDataUrl,
  mimeType,
} = {}) {
  const imageInputs = Array.isArray(images)
    ? images
    : [{ imageBase64, imageDataUrl, mimeType }];

  return imageInputs
    .map((image) => toVisionImageInput(image))
    .filter(Boolean);
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

function createKakaoCaptureError(code, message, cause) {
  const error = new Error(code);
  error.code = code;
  error.message = code;
  error.details = message;
  error.cause = cause;

  return error;
}

function parseVisionCredentialsJson() {
  if (!process.env.GOOGLE_VISION_CREDENTIALS_JSON) {
    return null;
  }

  try {
    return JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS_JSON);
  } catch (error) {
    throw createKakaoCaptureError(
      "KAKAO_CAPTURE_OCR_CONFIG_INVALID",
      "GOOGLE_VISION_CREDENTIALS_JSON is not valid JSON.",
      error,
    );
  }
}

function buildVisionClientOptions() {
  const credentialsJson = parseVisionCredentialsJson();

  if (credentialsJson) {
    return {
      projectId: credentialsJson.project_id,
      credentials: credentialsJson,
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    };
  }

  if (
    process.env.GOOGLE_CLOUD_PROJECT_ID &&
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
    };
  }

  if (process.env.GOOGLE_VISION_USE_ADC === "true") {
    return {};
  }

  throw createKakaoCaptureError(
    "KAKAO_CAPTURE_OCR_CONFIG_MISSING",
    GOOGLE_VISION_CONFIG_MESSAGE,
  );
}

function createDefaultVisionClient() {
  return new vision.ImageAnnotatorClient(buildVisionClientOptions());
}

function getVertices(boundingBox = {}) {
  const vertices = boundingBox.normalizedVertices?.length
    ? boundingBox.normalizedVertices
    : boundingBox.vertices;

  return Array.isArray(vertices) ? vertices : [];
}

function getBoundingMetrics(boundingBox = {}, pageWidth = 1, pageHeight = 1) {
  const vertices = getVertices(boundingBox);

  if (!vertices.length) {
    return null;
  }

  const xs = vertices.map((vertex) =>
    Number.isFinite(vertex.x) ? vertex.x : 0,
  );
  const ys = vertices.map((vertex) =>
    Number.isFinite(vertex.y) ? vertex.y : 0,
  );

  const usesNormalizedVertices = boundingBox.normalizedVertices?.length > 0;
  const scaleX = usesNormalizedVertices ? pageWidth : 1;
  const scaleY = usesNormalizedVertices ? pageHeight : 1;
  const minX = Math.min(...xs) * scaleX;
  const maxX = Math.max(...xs) * scaleX;
  const minY = Math.min(...ys) * scaleY;
  const maxY = Math.max(...ys) * scaleY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function symbolText(symbol = {}) {
  const text = symbol.text || "";
  const breakType = symbol.property?.detectedBreak?.type;

  if (["SPACE", "SURE_SPACE", "EOL_SURE_SPACE"].includes(breakType)) {
    return `${text} `;
  }

  if (breakType === "LINE_BREAK") {
    return `${text}\n`;
  }

  return text;
}

function wordText(word = {}) {
  const text = (word.symbols || []).map(symbolText).join("");

  return text.trim();
}

function paragraphText(paragraph = {}) {
  return (paragraph.words || [])
    .map(wordText)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeOcrText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isLikelyNonMessageText(text) {
  const normalizedText = normalizeOcrText(text);

  if (!normalizedText) {
    return true;
  }

  return NON_MESSAGE_TEXT_PATTERNS.some((pattern) =>
    pattern.test(normalizedText),
  );
}

function isInsideChatContentColumn(item) {
  const leftBoundary =
    item.pageWidth * CHAT_CONTENT_HORIZONTAL_PADDING_RATIO;
  const rightBoundary =
    item.pageWidth * (1 - CHAT_CONTENT_HORIZONTAL_PADDING_RATIO);

  return item.centerX >= leftBoundary && item.centerX <= rightBoundary;
}

function configuredSenderNames() {
  return (process.env.KAKAO_CAPTURE_SENDER_NAMES || "")
    .split(",")
    .map((name) => normalizeOcrText(name))
    .filter(Boolean);
}

function isConfiguredSenderName(text) {
  const normalizedText = normalizeOcrText(text);

  return configuredSenderNames().includes(normalizedText);
}

function isLeftSideText(item) {
  return item.centerX < item.pageWidth / 2;
}

function isLikelyLeftSenderNameLabel(item, nextItem) {
  if (!nextItem) return false;
  if (item.pageIndex !== nextItem.pageIndex) return false;
  if (!isLeftSideText(item) || !isLeftSideText(nextItem)) return false;
  if (item.text.includes("\n")) return false;
  if (item.text.length > SENDER_NAME_LABEL_MAX_LENGTH) return false;
  if (/[.!?。！？]$/u.test(item.text)) return false;

  const verticalGap = nextItem.minY - item.maxY;
  const horizontalDistance = Math.abs(nextItem.minX - item.minX);

  return (
    verticalGap >= -4 &&
    verticalGap <= SENDER_NAME_LABEL_MAX_GAP_PX &&
    horizontalDistance <= 90 &&
    item.maxY < nextItem.centerY
  );
}

function extractTextItems(fullTextAnnotation = {}) {
  const items = [];
  const pages = fullTextAnnotation.pages || [];

  pages.forEach((page, pageIndex) => {
    const pageWidth = page.width || 1;
    const pageHeight = page.height || 1;

    (page.blocks || []).forEach((block) => {
      (block.paragraphs || []).forEach((paragraph) => {
        const text = paragraphText(paragraph);
        const bounds = getBoundingMetrics(
          paragraph.boundingBox || block.boundingBox,
          pageWidth,
          pageHeight,
        );

        const normalizedText = normalizeOcrText(text);

        if (!normalizedText || !bounds) return;

        items.push({
          pageIndex,
          pageWidth,
          pageHeight,
          text: normalizedText,
          ...bounds,
        });
      });
    });
  });

  return items;
}

function textItemsToMessages(items = []) {
  const sortedItems = items
    .filter((item) => isInsideChatContentColumn(item))
    .filter((item) => !isLikelyNonMessageText(item.text))
    .sort((left, right) => {
      if (left.pageIndex !== right.pageIndex) {
        return left.pageIndex - right.pageIndex;
      }

      if (Math.abs(left.centerY - right.centerY) > 8) {
        return left.centerY - right.centerY;
      }

      return left.centerX - right.centerX;
    })
    .filter((item, index, sorted) => {
      if (isConfiguredSenderName(item.text)) {
        return false;
      }

      return !isLikelyLeftSenderNameLabel(item, sorted[index + 1]);
    });

  const groupedMessages = [];

  for (const item of sortedItems) {
    const speaker = item.centerX >= item.pageWidth / 2 ? "A" : "B";
    const previous = groupedMessages[groupedMessages.length - 1];

    if (
      previous &&
      previous.pageIndex === item.pageIndex &&
      previous.speaker === speaker &&
      item.minY - previous.maxY <= SAME_MESSAGE_VERTICAL_GAP_PX
    ) {
      previous.text = `${previous.text}\n${item.text}`;
      previous.minY = Math.min(previous.minY, item.minY);
      previous.maxY = Math.max(previous.maxY, item.maxY);
      previous.centerY = (previous.minY + previous.maxY) / 2;
      continue;
    }

    groupedMessages.push({
      order: groupedMessages.length + 1,
      speaker,
      text: item.text,
      time: null,
      pageIndex: item.pageIndex,
      minY: item.minY,
      maxY: item.maxY,
      centerY: item.centerY,
    });
  }

  return groupedMessages.map(({ pageIndex, minY, maxY, centerY, ...message }) => message);
}

async function detectDocumentText({ client, imageBase64 }) {
  try {
    const [result] = await client.documentTextDetection({
      image: {
        content: imageBase64,
      },
    });

    return result || {};
  } catch (error) {
    const message = error?.message || "";

    if (message.includes("Could not load the default credentials")) {
      throw createKakaoCaptureError(
        "KAKAO_CAPTURE_OCR_CONFIG_MISSING",
        GOOGLE_VISION_CONFIG_MESSAGE,
        error,
      );
    }

    if (
      error?.code === 7 ||
      error?.code === 16 ||
      message.includes("PERMISSION_DENIED") ||
      message.includes("UNAUTHENTICATED")
    ) {
      throw createKakaoCaptureError(
        "KAKAO_CAPTURE_OCR_AUTH_FAILED",
        "Google Vision OCR authentication or permission check failed.",
        error,
      );
    }

    throw createKakaoCaptureError(
      "KAKAO_CAPTURE_OCR_REQUEST_FAILED",
      "Google Vision OCR request failed.",
      error,
    );
  }
}

export async function parseKakaoCaptureImage({
  imageBase64,
  imageDataUrl,
  mimeType,
  images,
  client,
  visionClient = client || createDefaultVisionClient(),
  model = KAKAO_CAPTURE_PARSER_MODEL,
} = {}) {
  const imageInputs = normalizeVisionImageInputs({
    images,
    imageBase64,
    imageDataUrl,
    mimeType,
  });

  if (!imageInputs.length) {
    const error = new Error("KAKAO_CAPTURE_IMAGE_REQUIRED");
    error.code = "KAKAO_CAPTURE_IMAGE_REQUIRED";
    throw error;
  }

  const detections = await Promise.all(
    imageInputs.map((image) =>
      detectDocumentText({
        client: visionClient,
        imageBase64: image.imageBase64,
      }),
    ),
  );

  const textItems = detections.flatMap((detection, imageIndex) =>
    extractTextItems(detection.fullTextAnnotation).map((item) => ({
      ...item,
      pageIndex: imageIndex,
    })),
  );

  const messages = normalizeKakaoMessages(textItemsToMessages(textItems));
  const rawTexts = buildSpeakerRawTexts(messages);
  const notes = detections
    .map((detection, index) =>
      detection.fullTextAnnotation?.text
        ? null
        : `No text detected in image ${index + 1}.`,
    )
    .filter(Boolean);

  return {
    model,
    imageCount: imageInputs.length,
    messages,
    rawTexts,
    combinedText: buildCombinedConversation(messages),
    notes,
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
