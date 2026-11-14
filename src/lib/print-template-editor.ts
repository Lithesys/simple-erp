import {
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
import StarterKit from "@tiptap/starter-kit";

function applyMarkToEveryNode(
  content: JSONContent[],
  markType: string,
): JSONContent[] {
  return content.map((node) => {
    const marks = node.marks ?? [];
    const nextMarks = marks.some((mark) => mark.type === markType)
      ? marks
      : [...marks, { type: markType }];
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
    const wrapper = wrappers[mark.type];
    if (wrapper) output = `${wrapper[0]}${output}${wrapper[1]}`;
  }
  return output;
}

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
        strike: false,
        underline: false,
      }),
      PrintTemplateMarkdownBold,
      PrintTemplateMarkdownItalic,
      PrintTemplateMarkdownStrike,
      PrintTemplateMarkdownUnderline,
      PrintTemplateFieldNode,
    ],
    markedOptions: { gfm: true },
  });
}
