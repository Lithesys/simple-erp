import {
  Mark,
  Node,
  mergeAttributes,
  type JSONContent,
  type MarkdownTokenizer,
} from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import { MarkdownManager } from "@tiptap/markdown";
import Paragraph from "@tiptap/extension-paragraph";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import { PRINT_TEMPLATE_FONT_SIZES } from "./print-template";

const fontSizeSet = new Set<number>(PRINT_TEMPLATE_FONT_SIZES);

export function normalizePrintTemplateFontSize(value: unknown) {
  const size = Number(value);
  return fontSizeSet.has(size) ? size : 11;
}

function fontSizeClass(size: unknown) {
  return `receipt-font-size-${normalizePrintTemplateFontSize(size)}`;
}

function applyMarkToEveryNode(
  content: JSONContent[],
  markType: string,
  attributes?: Record<string, unknown>,
): JSONContent[] {
  return content.map((node) => {
    const marks = node.marks ?? [];
    const existingMark = marks.find((mark) => mark.type === markType);
    const nextMarks = existingMark
      ? marks.map((mark) =>
          mark.type === markType
            ? { ...mark, attrs: { ...mark.attrs, ...attributes } }
            : mark,
        )
      : [
          ...marks,
          { type: markType, ...(attributes ? { attrs: attributes } : {}) },
        ];
    return {
      ...node,
      marks: nextMarks,
      ...(node.content
        ? { content: applyMarkToEveryNode(node.content, markType) }
        : {}),
    };
  });
}

function createHtmlMarkTokenizer(
  tokenName: string,
  tags: string[],
): MarkdownTokenizer {
  const tagPattern = tags.join("|");
  return {
    name: `printTemplate${tokenName}Html`,
    level: "inline",
    start: (source) => {
      const lowerSource = source.toLowerCase();
      const matches = tags
        .map((tag) => lowerSource.indexOf(`<${tag}>`))
        .filter((index) => index >= 0);
      return matches.length ? Math.min(...matches) : -1;
    },
    tokenize: (source, _tokens, lexer) => {
      const openingTag = new RegExp(`^<(${tagPattern})>`, "i").exec(source);
      if (!openingTag) return undefined;
      const closingTag = new RegExp(`</${openingTag[1]}>`, "i");
      const closingMatch = closingTag.exec(source.slice(openingTag[0].length));
      if (!closingMatch) return undefined;
      const text = source.slice(
        openingTag[0].length,
        openingTag[0].length + closingMatch.index,
      );
      if (!text) return undefined;
      const raw = source.slice(
        0,
        openingTag[0].length + closingMatch.index + closingMatch[0].length,
      );
      return { type: tokenName, raw, text, tokens: lexer.inlineTokens(text) };
    },
  };
}

function renderFieldToken(node: JSONContent) {
  let output = `{{${String(node.attrs?.token ?? "")}}}`;
  const wrappers: Record<string, [string, string]> = {
    bold: ["<strong>", "</strong>"],
    italic: ["<em>", "</em>"],
    strike: ["<del>", "</del>"],
    underline: ["<ins>", "</ins>"],
  };
  for (const mark of node.marks ?? []) {
    if (mark.type === "printTemplateFontSize") {
      output = `<span class="${fontSizeClass(mark.attrs?.fontSize)}">${output}</span>`;
      continue;
    }
    const wrapper = wrappers[mark.type];
    if (wrapper) output = `${wrapper[0]}${output}${wrapper[1]}`;
  }
  return output;
}

export const PrintTemplateParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const parsed =
      this.parent?.(token, helpers) ??
      helpers.createNode(
        "paragraph",
        undefined,
        helpers.parseInline(token.tokens ?? []),
      );
    const alignment = token.printTemplateAlignment;
    if (
      !alignment ||
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== "object"
    ) {
      return parsed;
    }
    return {
      ...parsed,
      attrs: { ...parsed.attrs, textAlign: alignment },
    };
  },

  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? "";
    const alignment = node.attrs?.textAlign;
    if (!alignment || alignment === "left") return markdown;
    if (alignment !== "center" && alignment !== "right") return markdown;
    return `:::print-align=${alignment}\n${markdown}\n:::`;
  },

  markdownTokenizer: {
    name: "printTemplateAlignedParagraph",
    level: "block",
    start: (source) => source.indexOf(":::print-align="),
    tokenize: (source, _tokens, lexer) => {
      const match =
        /^:::print-align=(left|center|right)[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?:\r?\n|$)/i.exec(
          source,
        );
      if (!match) return undefined;
      const alignment = match[1].toLowerCase();
      const text = match[2];
      return {
        type: "paragraph",
        raw: match[0],
        text,
        tokens: lexer.inlineTokens(text),
        printTemplateAlignment: alignment,
      };
    },
  },
});

export const PrintTemplateColumns = Node.create({
  name: "printTemplateColumns",
  group: "block",
  content: "paragraph paragraph",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-print-columns='2']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "print-template-columns",
        "data-print-columns": "2",
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "printTemplateColumns",
    level: "block",
    start: (source) => source.indexOf(":::print-columns"),
    tokenize: (source, _tokens, lexer) => {
      const match =
        /^:::print-columns\s*\r?\n([\s\S]*?)\r?\n\|\|\|\r?\n([\s\S]*?)\r?\n:::[ \t]*(?:\r?\n|$)/.exec(
          source,
        );
      if (!match) return undefined;
      return {
        type: "printTemplateColumns",
        raw: match[0],
        leftTokens: lexer.inlineTokens(match[1]),
        rightTokens: lexer.inlineTokens(match[2]),
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("printTemplateColumns", undefined, [
      helpers.createNode(
        "paragraph",
        undefined,
        helpers.parseInline(token.leftTokens ?? []),
      ),
      helpers.createNode(
        "paragraph",
        undefined,
        helpers.parseInline(token.rightTokens ?? []),
      ),
    ]);
  },

  renderMarkdown(node, helpers) {
    const left = helpers.renderChildren(node.content?.[0]?.content ?? []);
    const right = helpers.renderChildren(node.content?.[1]?.content ?? []);
    return `:::print-columns\n${left}\n|||\n${right}\n:::`;
  },
});

export const PrintTemplateMarkdownBold = Bold.extend({
  parseMarkdown(token, helpers) {
    return applyMarkToEveryNode(
      helpers.parseInline(token.tokens ?? []),
      "bold",
    );
  },
  markdownTokenizer: createHtmlMarkTokenizer("strong", ["strong", "b"]),
});

export const PrintTemplateMarkdownItalic = Italic.extend({
  parseMarkdown(token, helpers) {
    return applyMarkToEveryNode(
      helpers.parseInline(token.tokens ?? []),
      "italic",
    );
  },
  markdownTokenizer: createHtmlMarkTokenizer("em", ["em", "i"]),
});

export const PrintTemplateMarkdownStrike = Strike.extend({
  parseMarkdown(token, helpers) {
    return applyMarkToEveryNode(
      helpers.parseInline(token.tokens ?? []),
      "strike",
    );
  },
  markdownTokenizer: createHtmlMarkTokenizer("del", ["del", "s", "strike"]),
});

export const PrintTemplateMarkdownUnderline = Underline.extend({
  parseHTML() {
    return [{ tag: "ins" }, { tag: "u" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "ins",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  renderMarkdown(node, helpers) {
    return `<ins>${helpers.renderChildren(node.content ?? [])}</ins>`;
  },

  parseMarkdown(token, helpers) {
    return applyMarkToEveryNode(
      helpers.parseInline(token.tokens ?? []),
      "underline",
    );
  },

  markdownTokenizer: createHtmlMarkTokenizer("underline", ["ins", "u"]),
});

export const PrintTemplateFontSize = Mark.create({
  name: "printTemplateFontSize",

  addAttributes() {
    return { fontSize: { default: 11 } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-print-font-size]",
        getAttrs: (element) => ({
          fontSize: normalizePrintTemplateFontSize(
            (element as HTMLElement).dataset.printFontSize,
          ),
        }),
      },
    ];
  },

  renderHTML({ mark, HTMLAttributes }) {
    const fontSize = normalizePrintTemplateFontSize(mark.attrs.fontSize);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: fontSizeClass(fontSize),
        "data-print-font-size": String(fontSize),
      }),
      0,
    ];
  },

  markdownTokenName: "printTemplateFontSize",
  markdownTokenizer: {
    name: "printTemplateFontSize",
    level: "inline",
    start: (source) => source.indexOf('<span class="receipt-font-size-'),
    tokenize: (source, _tokens, lexer) => {
      const opening = /^<span class="receipt-font-size-(\d+)">/.exec(source);
      if (!opening) return undefined;
      const fontSize = Number(opening[1]);
      if (!fontSizeSet.has(fontSize)) return undefined;
      const closingIndex = source.indexOf("</span>", opening[0].length);
      if (closingIndex < 0) return undefined;
      const text = source.slice(opening[0].length, closingIndex);
      const raw = source.slice(0, closingIndex + "</span>".length);
      return {
        type: "printTemplateFontSize",
        raw,
        text,
        fontSize,
        tokens: lexer.inlineTokens(text),
      };
    },
  },

  renderMarkdown(mark, helpers) {
    const fontSize = normalizePrintTemplateFontSize(mark.attrs?.fontSize);
    return `<span class="${fontSizeClass(fontSize)}">${helpers.renderChildren(mark.content ?? [])}</span>`;
  },

  parseMarkdown(token, helpers) {
    return applyMarkToEveryNode(
      helpers.parseInline(token.tokens ?? []),
      "printTemplateFontSize",
      { fontSize: normalizePrintTemplateFontSize(token.fontSize) },
    );
  },
});

export const PrintTemplateFieldNode = Node.create({
  name: "printTemplateField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { token: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-print-template-field]",
        getAttrs: (element) => ({
          token: (element as HTMLElement).dataset.printTemplateField || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      { ...HTMLAttributes, "data-print-template-field": node.attrs.token },
      `{{${node.attrs.token}}}`,
    ];
  },

  markdownTokenName: "printTemplateField",
  markdownTokenizer: {
    name: "printTemplateField",
    level: "inline",
    start: (source) => source.indexOf("{{"),
    tokenize: (source) => {
      const match = /^\{\{\s*([\w.-]+)\s*\}\}/.exec(source);
      if (!match) return undefined;
      return { type: "printTemplateField", raw: match[0], token: match[1] };
    },
  },
  parseMarkdown: (token) => ({
    type: "printTemplateField",
    attrs: { token: String(token.token ?? token.text ?? "") },
  }),
  renderMarkdown: renderFieldToken,
});

export function createPrintTemplateMarkdownManager() {
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        paragraph: false,
        strike: false,
        underline: false,
      }),
      PrintTemplateParagraph,
      PrintTemplateColumns,
      TextAlign.configure({ types: ["paragraph"] }),
      TableKit.configure({
        table: {
          resizable: true,
          renderWrapper: true,
          HTMLAttributes: { class: "print-template-edit-table" },
        },
      }),
      PrintTemplateMarkdownBold,
      PrintTemplateMarkdownItalic,
      PrintTemplateMarkdownStrike,
      PrintTemplateMarkdownUnderline,
      PrintTemplateFontSize,
      PrintTemplateFieldNode,
    ],
    markedOptions: { gfm: true },
  });
}
