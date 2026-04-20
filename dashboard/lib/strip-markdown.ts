/**
 * Strips markdown syntax from text to produce clean plain text for TTS.
 */
export function stripMarkdown(markdown: string): string {
  let text = markdown;

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Remove code blocks (fenced) — keep content
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```\w*\n?/g, "").replace(/```/g, "");
  });

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove images (keep alt text)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove links (keep link text)
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove headings (keep text, add a period for pacing)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1.");

  // Remove bold/italic markers
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/___([^_]+)___/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");

  // Remove strikethrough
  text = text.replace(/~~([^~]+)~~/g, "$1");

  // Remove blockquotes
  text = text.replace(/^\s*>\s?/gm, "");

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove unordered list markers
  text = text.replace(/^\s*[-*+]\s+/gm, "");

  // Remove ordered list markers
  text = text.replace(/^\s*\d+\.\s+/gm, "");

  // Remove extra whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}