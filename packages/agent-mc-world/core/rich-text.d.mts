export type RichTextFacts = {
  clicks: Array<{ action: string; value: string; label: string }>;
  hovers: Array<{ action: string; text: string }>;
  fonts: string[];
  icons: Array<{ code: string; font: string }>;
  translateKeys: string[];
  colors: string[];
};
export function richTextFacts(value: unknown): RichTextFacts;
export function richTextAnnotation(value: unknown, options?: { maxHover?: number }): string;
