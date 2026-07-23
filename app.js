const sampleDocument = `# Markdown LaTeX PDF Studio

[[toc]]

## Markdown

Use **bold**, _italic_, ++underline++, tables, footnotes, task lists, fenced code, diagrams, and page breaks.

- [x] Live preview
- [x] LaTeX rendering
- [x] Mermaid diagrams
- [x] Print

| Feature | Status |
| --- | --- |
| Markdown | Ready |
| LaTeX | Ready |
| Print | Ready |

Definition term
: Definition list support

Footnote reference.[^demo]

[^demo]: Footnotes render at the end of the document.

## LaTeX

Inline math: $e^{i\\pi}+1=0$.

Display math:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Code

\`\`\`js
function convert(markdown) {
  return marked.parse(markdown);
}
\`\`\`

## Diagram

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[HTML]
  B --> C[MathJax]
  C --> D[Print]
\`\`\`

<div class="page-break"></div>

## Second Page

Print uses the current theme, page size, margin, equations, code highlighting, tables, and diagrams.`;

const templates = {
  paper: sampleDocument,
  report: `# Technical Report

[[toc]]

## Executive Summary

State the decision, evidence, and impact.

## System Design

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant P as Print Dialog
  U->>A: Write Markdown + LaTeX
  A->>A: Render preview
  A->>P: Print
\`\`\`

## Analysis

| Metric | Value | Notes |
| --- | ---: | --- |
| Latency | 120 ms | Local render |
| Pages | 8 | A4 |

## Equation

$$
S = \\sum_{i=1}^{n} x_i^2
$$

## Conclusion

Clear next action.`,
  math: `# Math Notes

## Identities

Inline: $\\nabla \\cdot \\vec{E} = \\rho / \\epsilon_0$.

$$
\\begin{aligned}
a^2 + b^2 &= c^2 \\\\
F(s) &= \\int_0^\\infty f(t)e^{-st}\\,dt
\\end{aligned}
$$

## Matrix

$$
\\begin{bmatrix}
1 & 2 \\\\
3 & 4
\\end{bmatrix}
$$`
};

const editor = document.getElementById("editor");
const lineNumbers = document.getElementById("line-numbers");
const preview = document.getElementById("preview");
const pagedOutput = document.getElementById("paged-output");
const fileInput = document.getElementById("file-input");
const docTitle = document.getElementById("doc-title");
const pageSize = document.getElementById("page-size");
const pageMargin = document.getElementById("page-margin");
const previewTheme = document.getElementById("preview-theme");
const darkPalette = document.getElementById("dark-palette");
const codeWrap = document.getElementById("code-wrap");
const smartPagination = document.getElementById("smart-pagination");
const editorWrap = document.getElementById("editor-wrap");
const editorContainer = document.querySelector(".editor-wrap");
const appShell = document.querySelector(".app-shell");
const toolsPanel = document.getElementById("format-panel");
const previewPanel = document.getElementById("preview-panel");
const toggleTools = document.getElementById("toggle-tools");
const togglePreview = document.getElementById("toggle-preview");
const editorResizeHandle = document.getElementById("editor-resize-handle");
const previewResizeHandle = document.getElementById("preview-resize-handle");
const tabletViewport = window.matchMedia("(max-width: 1024px)");
const phoneViewport = window.matchMedia("(max-width: 760px)");
let renderTimer = 0;
let markdownEngine;
let hasFootnotePlugin = false;
let customTitle = localStorage.getItem("markdown-pdf-title-custom") === "true";
let isResizing = false;
let resizeHandle = null;
let resizeStartX = 0;
let resizeStartEditorWidth = 0;
let resizeStartPreviewWidth = 0;
let renderedLineCount = 0;
let savedContentSnapshot = "";
let hasUnsavedChanges = false;
let pagedPreviewer = null;
let detachedPreviewContent = null;
let renderedSignature = "";
let renderQueue = Promise.resolve();
const lineMeasure = document.createElement("div");
lineMeasure.className = "editor-line-measure";
document.body.appendChild(lineMeasure);

document.addEventListener("DOMContentLoaded", async () => {
  configureMarked();
  editor.value = localStorage.getItem("markdown-pdf-content") || sampleDocument;
  markContentSaved();
  updateLineNumbers();
  docTitle.value = customTitle ? localStorage.getItem("markdown-pdf-title") || deriveDocumentTitle(editor.value) : deriveDocumentTitle(editor.value);
  updateBrowserTitle();
  const savedTheme = localStorage.getItem("markdown-pdf-theme") || "paper";
  previewTheme.value = savedTheme === "dark" ? "paper" : savedTheme;
  darkPalette.checked = localStorage.getItem("markdown-pdf-dark-palette") === "true" || savedTheme === "dark";
  pageSize.value = localStorage.getItem("markdown-pdf-page-size") || "a4";
  pageMargin.value = localStorage.getItem("markdown-pdf-page-margin") || "16";
  codeWrap.checked = localStorage.getItem("markdown-pdf-code-wrap") === "true";
  smartPagination.checked = localStorage.getItem("markdown-pdf-smart-pagination") !== "false";
  editorWrap.checked = localStorage.getItem("markdown-pdf-editor-wrap") === "true";
  applyEditorWrap();
  restorePaneWidths();
  applyResponsivePaneState();
  bindEvents();
  await render();
  runDependencyHealthCheck();
});

function configureMarked() {
  if (typeof window.markdownit !== "function") {
    markdownEngine = createFallbackMarkdownEngine();
    hasFootnotePlugin = false;
    return;
  }

  markdownEngine = window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    highlight(code, language) {
      const lang = String(language || "").trim();
      if (lang === "mermaid") return `<pre class="mermaid">${escapeHtml(code)}</pre>`;
      return renderCodeBlock(code, lang);
    }
  });
  hasFootnotePlugin = typeof window.markdownitFootnote === "function";
  [
    window.markdownitAbbr,
    window.markdownitDeflist,
    window.markdownitEmoji,
    window.markdownitFootnote,
    window.markdownitIns,
    window.markdownitMark,
    window.markdownitSub,
    window.markdownitSup,
    window.markdownitTaskLists
  ].filter(Boolean).forEach((plugin) => markdownEngine.use(plugin, { enabled: true }));
  markdownEngine.enable(["table", "strikethrough"]);
  addHeadingAnchors();
}

function createFallbackMarkdownEngine() {
  return {
    render: renderFallbackMarkdown,
    renderInline: renderFallbackInline
  };
}

function addHeadingAnchors() {
  const original = markdownEngine.renderer.rules.heading_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  markdownEngine.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const inline = tokens[index + 1];
    if (inline?.type === "inline") {
      tokens[index].attrSet("id", slug(stripMarkdown(inline.content)));
    }
    return original(tokens, index, options, env, self);
  };
}

function runDependencyHealthCheck() {
  const versions = {
    dompurify: window.DOMPurify?.version || "fallback",
    markdownit: window.markdownit ? "latest" : "fallback",
    highlight: window.hljs?.versionString || "fallback",
    mermaid: window.mermaid?.version || "latest",
    mathjax: window.MathJax?.version || "fallback",
    pagedjs: window.Paged?.Previewer ? "0.4.3" : "unavailable"
  };
  const checks = {
    sanitizer: typeof window.DOMPurify?.sanitize === "function" || typeof sanitizePreviewHtml === "function",
    markdown: typeof markdownEngine?.render === "function",
    markdownInline: typeof markdownEngine?.renderInline === "function",
    highlight: !window.hljs || (typeof window.hljs.highlight === "function" && typeof window.hljs.getLanguage === "function"),
    mermaid: !window.mermaid || (typeof window.mermaid.initialize === "function" && typeof window.mermaid.render === "function"),
    mathjax: !window.MathJax || typeof window.MathJax.typesetPromise === "function",
    pagedjs: !smartPagination.checked || typeof window.Paged?.Previewer === "function"
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const deprecations = [...new Set(window.dependencyWarnings || [])];
  const previous = localStorage.getItem("markdown-pdf-dependency-versions");
  const current = JSON.stringify(versions);

  if (previous !== current || failed.length || deprecations.length) {
    console.info("Dependency health check", { versions, checks, deprecations });
    localStorage.setItem("markdown-pdf-dependency-versions", current);
  }
  if (failed.length) console.warn(`Dependency compatibility issue: ${failed.join(", ")}`);
  if (deprecations.length) console.warn(`Dependency deprecation warning: ${deprecations.join(" | ")}`);
}

function bindEvents() {
  editor.addEventListener("input", () => {
    localStorage.setItem("markdown-pdf-content", editor.value);
    updateUnsavedState();
    updateLineNumbers();
    updateAutoTitle();
    scheduleRender();
  });
  editor.addEventListener("scroll", syncLineNumbers);
  window.addEventListener("beforeunload", warnBeforeClose);
  window.addEventListener("afterprint", clearPagedDocument);
  new ResizeObserver(() => updateLineNumbers(true)).observe(editor);

  previewTheme.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-theme", previewTheme.value);
    render(true);
  });

  docTitle.addEventListener("input", () => {
    if (!docTitle.value.trim()) {
      customTitle = false;
      localStorage.setItem("markdown-pdf-title-custom", "false");
      updateAutoTitle();
      return;
    }
    customTitle = true;
    localStorage.setItem("markdown-pdf-title-custom", "true");
    localStorage.setItem("markdown-pdf-title", docTitle.value);
    updateBrowserTitle();
  });
  pageSize.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-page-size", pageSize.value);
    applyFormattingSettings();
  });
  pageMargin.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-page-margin", pageMargin.value);
    applyFormattingSettings();
  });
  darkPalette.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-dark-palette", String(darkPalette.checked));
    render(true);
  });
  codeWrap.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-code-wrap", String(codeWrap.checked));
    applyFormattingSettings();
  });
  smartPagination.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-smart-pagination", String(smartPagination.checked));
    applyFormattingSettings();
  });
  editorWrap.addEventListener("change", () => {
    localStorage.setItem("markdown-pdf-editor-wrap", String(editorWrap.checked));
    applyEditorWrap();
  });
  document.getElementById("open-file").addEventListener("click", () => fileInput.click());
  document.getElementById("save-md").addEventListener("click", saveMarkdown);
  document.getElementById("save-html").addEventListener("click", saveHtml);
  document.getElementById("print-document").addEventListener("click", printDocument);
  document.getElementById("format-md").addEventListener("click", formatMarkdown);
  toggleTools.addEventListener("click", () => toggleResponsivePane("tools"));
  togglePreview.addEventListener("click", () => toggleResponsivePane("preview"));
  tabletViewport.addEventListener("change", applyResponsivePaneState);
  phoneViewport.addEventListener("change", applyResponsivePaneState);

  fileInput.addEventListener("change", openMarkdownFile);

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => insertSnippet(button.dataset.insert));
  });

  document.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", () => {
      editor.value = templates[button.dataset.template];
      localStorage.setItem("markdown-pdf-content", editor.value);
      updateUnsavedState();
      updateLineNumbers();
      updateAutoTitle();
      render();
    });
  });

  // Resize handle events
  editorResizeHandle.addEventListener("mousedown", (e) => startResize(e, "editor"));
  previewResizeHandle.addEventListener("mousedown", (e) => startResize(e, "preview"));
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", endResize);
}

function toggleResponsivePane(pane) {
  const storageKey = pane === "tools" ? "markdown-pdf-tools-visible" : "markdown-pdf-preview-visible";
  const collapsedClass = pane === "tools" ? "tools-collapsed" : "preview-collapsed";
  const visible = appShell.classList.contains(collapsedClass);
  localStorage.setItem(storageKey, String(visible));
  applyResponsivePaneState();
}

function applyResponsivePaneState() {
  const toolsVisible = getPanePreference("markdown-pdf-tools-visible", !tabletViewport.matches);
  const previewVisible = getPanePreference("markdown-pdf-preview-visible", !phoneViewport.matches);

  appShell.classList.toggle("tools-collapsed", !toolsVisible);
  appShell.classList.toggle("preview-collapsed", !previewVisible);
  toolsPanel.toggleAttribute("hidden", !toolsVisible);
  previewPanel.toggleAttribute("hidden", !previewVisible);
  toggleTools.setAttribute("aria-expanded", String(toolsVisible));
  togglePreview.setAttribute("aria-expanded", String(previewVisible));
}

function getPanePreference(key, fallback) {
  const saved = localStorage.getItem(key);
  return saved === null ? fallback : saved === "true";
}

function restorePaneWidths() {
  const savedEditorWidth = localStorage.getItem("markdown-pdf-editor-width");
  const savedPreviewWidth = localStorage.getItem("markdown-pdf-preview-width");
  
  // Only one pane should have a fixed width at a time; the other flexes
  if (savedEditorWidth) {
    document.documentElement.style.setProperty("--editor-width", savedEditorWidth);
    document.documentElement.style.setProperty("--preview-width", "1fr");
  } else if (savedPreviewWidth) {
    document.documentElement.style.setProperty("--preview-width", savedPreviewWidth);
    document.documentElement.style.setProperty("--editor-width", "1fr");
  }
  // If neither is saved, both default to 1fr through CSS
}

function startResize(e, pane) {
  e.preventDefault();
  isResizing = true;
  resizeHandle = pane;
  resizeStartX = e.clientX;
  
  const editorRect = document.querySelector(".editor-pane").getBoundingClientRect();
  const previewRect = document.querySelector(".preview-pane").getBoundingClientRect();
  
  if (pane === "editor") {
    resizeStartEditorWidth = editorRect.width;
  } else if (pane === "preview") {
    resizeStartPreviewWidth = previewRect.width;
  }
  
  appShell.classList.add("resizing");
  document.body.style.userSelect = "none";
}

function onResize(e) {
  if (!isResizing) return;
  e.preventDefault();
  
  const deltaX = e.clientX - resizeStartX;
  
  if (resizeHandle === "editor") {
    // Resize editor pane - editor gets fixed width, preview uses remaining space (1fr)
    const newEditorWidth = Math.max(150, resizeStartEditorWidth + deltaX);
    document.documentElement.style.setProperty("--editor-width", `${newEditorWidth}px`);
    document.documentElement.style.setProperty("--preview-width", "1fr");
  } else if (resizeHandle === "preview") {
    // Resize preview pane - preview gets fixed width, editor uses remaining space (1fr)
    const newPreviewWidth = Math.max(150, resizeStartPreviewWidth + deltaX);
    document.documentElement.style.setProperty("--preview-width", `${newPreviewWidth}px`);
    document.documentElement.style.setProperty("--editor-width", "1fr");
  }
}

function endResize() {
  if (!isResizing) return;
  isResizing = false;
  resizeHandle = null;
  appShell.classList.remove("resizing");
  document.body.style.userSelect = "";
  
  // Save the width of the pane that was resized; clear the other
  const editorWidth = getComputedStyle(document.documentElement).getPropertyValue("--editor-width").trim();
  const previewWidth = getComputedStyle(document.documentElement).getPropertyValue("--preview-width").trim();
  
  if (editorWidth !== "1fr") {
    localStorage.setItem("markdown-pdf-editor-width", editorWidth);
    localStorage.removeItem("markdown-pdf-preview-width");
  } else if (previewWidth !== "1fr") {
    localStorage.setItem("markdown-pdf-preview-width", previewWidth);
    localStorage.removeItem("markdown-pdf-editor-width");
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 160);
}

function updateLineNumbers(force = false) {
  const count = countEditorLines(editor.value);
  if (editorWrap.checked) {
    renderWrappedLineNumbers();
  } else if (force || count !== renderedLineCount) {
    let numbers = "1";
    for (let line = 2; line <= count; line += 1) numbers += `\n${line}`;
    lineNumbers.textContent = numbers;
  }
  renderedLineCount = count;
  syncLineNumbers();
}

function renderWrappedLineNumbers() {
  const editorStyle = getComputedStyle(editor);
  const contentWidth = editor.clientWidth
    - parseFloat(editorStyle.paddingLeft)
    - parseFloat(editorStyle.paddingRight);
  lineMeasure.style.width = `${Math.max(1, contentWidth)}px`;
  lineMeasure.style.font = editorStyle.font;
  lineMeasure.style.lineHeight = editorStyle.lineHeight;
  lineMeasure.style.letterSpacing = editorStyle.letterSpacing;
  lineMeasure.style.tabSize = editorStyle.tabSize;

  const fragment = document.createDocumentFragment();
  editor.value.split("\n").forEach((line, index) => {
    lineMeasure.textContent = line || "\u200b";
    const number = document.createElement("span");
    number.textContent = String(index + 1);
    number.style.height = `${lineMeasure.getBoundingClientRect().height}px`;
    fragment.appendChild(number);
  });
  lineNumbers.replaceChildren(fragment);
}

function countEditorLines(value) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function syncLineNumbers() {
  lineNumbers.scrollTop = editor.scrollTop;
}

function applyEditorWrap() {
  const enabled = editorWrap.checked;
  editor.wrap = enabled ? "soft" : "off";
  editorContainer.classList.toggle("word-wrap", enabled);
  editor.scrollLeft = 0;
  updateLineNumbers(true);
}

function updateAutoTitle() {
  if (customTitle) {
    updateBrowserTitle();
    return;
  }
  docTitle.value = deriveDocumentTitle(editor.value);
  localStorage.setItem("markdown-pdf-title", docTitle.value);
  updateBrowserTitle();
}

function deriveDocumentTitle(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]).find(Boolean);
  const firstLine = lines.find((line) => line.trim());
  return cleanTitle(heading || firstLine || "document");
}

function cleanTitle(value) {
  return stripMarkdown(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";
}

function updateBrowserTitle() {
  document.title = docTitle.value || deriveDocumentTitle(editor.value);
}

function markContentSaved() {
  savedContentSnapshot = editor.value;
  hasUnsavedChanges = false;
}

function updateUnsavedState() {
  hasUnsavedChanges = editor.value !== savedContentSnapshot;
}

function warnBeforeClose(event) {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "You have unsaved markdown changes. Save or print before closing this tab.";
  return event.returnValue;
}

async function render(force = false) {
  clearTimeout(renderTimer);
  renderTimer = 0;
  renderQueue = renderQueue.catch(() => {}).then(async () => {
    const markdown = editor.value;
    const signature = `${markdown}\u0000${previewTheme.value}\u0000${darkPalette.checked}`;
    if (!force && signature === renderedSignature && preview.childNodes.length) {
      applyFormattingSettings();
      return;
    }
    const html = buildHtml(markdown);
    preview.innerHTML = sanitizePreviewHtml(html, {
      ADD_TAGS: ["mjx-container"],
      ADD_ATTR: ["target", "class", "style"]
    });
    applyFormattingSettings();
    linkFootnoteNumbers();
    updateStats(markdown);
    await renderMermaid();
    await renderMath();
    renderedSignature = signature;
  });
  return renderQueue;
}

function linkFootnoteNumbers() {
  preview.querySelectorAll(".footnotes li").forEach((item, index) => {
    const paragraph = item.querySelector(":scope > p");
    if (paragraph) {
      while (paragraph.firstChild) item.insertBefore(paragraph.firstChild, paragraph);
      paragraph.remove();
    }
    if (item.querySelector(".footnote-number-backref")) return;
    const backref = item.querySelector(".footnote-backref");
    const href = backref?.getAttribute("href");
    if (!href) return;
    const link = document.createElement("a");
    link.className = "footnote-number-backref";
    link.href = href;
    link.textContent = `${index + 1}.`;
    item.insertBefore(link, item.firstChild);
    item.insertBefore(document.createTextNode(" "), link.nextSibling);
  });
}

function buildHtml(markdown) {
  const expanded = hasFootnotePlugin ? markdown : appendFallbackFootnotes(markdown);
  const withToc = expanded.replace(/\[\[toc\]\]/gi, buildToc(markdown));
  const protectedMath = protectMath(withToc);
  return restoreMath(markdownEngine.render(protectedMath.source), protectedMath.items);
}

function protectMath(markdown) {
  const items = [];
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  const source = parts.map((part) => {
    if (part.startsWith("```")) return part;
    return part
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => storeMath(items, "display", tex))
      .replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, prefix, tex) => `${prefix}${storeMath(items, "inline", tex)}`);
  }).join("");
  return { source, items };
}

function storeMath(items, type, tex) {
  const key = `@@MATH${items.length}@@`;
  items.push({ type, tex });
  return key;
}

function restoreMath(html, items) {
  return items.reduce((output, item, index) => {
    const tex = escapeHtml(item.tex.trim());
    const replacement = item.type === "display"
      ? `<div class="math-block">\\[${tex}\\]</div>`
      : `<span class="math-inline">\\(${tex}\\)</span>`;
    const key = `@@MATH${index}@@`;
    const blockPattern = new RegExp(`<p>\\s*${key}\\s*</p>`, "g");
    return output.replace(blockPattern, replacement).replaceAll(key, replacement);
  }, html);
}

function renderFallbackMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(language === "mermaid" ? `<pre class="mermaid mermaid-fallback">${escapeHtml(code.join("\n"))}</pre>` : renderCodeBlock(code.join("\n"), language));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = stripMarkdown(heading[2]);
      html.push(`<h${level} id="${slug(text)}">${renderFallbackInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\|.+\|\s*$/.test(line) && index + 1 < lines.length && /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const rows = [];
      while (index < lines.length && /^\|.+\|\s*$/.test(lines[index])) {
        rows.push(lines[index].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
        index += 1;
      }
      const header = rows[0];
      const body = rows.slice(2);
      html.push(`<table><thead><tr>${header.map((cell) => `<th>${renderFallbackInline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderFallbackInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    if (index + 1 < lines.length && /^:\s+/.test(lines[index + 1])) {
      const term = renderFallbackInline(line.trim());
      const definitions = [];
      index += 1;
      while (index < lines.length && /^:\s+/.test(lines[index])) {
        definitions.push(lines[index].replace(/^:\s+/, ""));
        index += 1;
      }
      html.push(`<dl><dt>${term}</dt>${definitions.map((definition) => `<dd>${renderFallbackInline(definition)}</dd>`).join("")}</dl>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderFallbackMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        const content = lines[index].replace(/^\s*[-*+]\s+/, "");
        const task = content.match(/^\[(x| )\]\s+(.+)$/i);
        items.push(task ? `<li><input type="checkbox" disabled ${task[1].toLowerCase() === "x" ? "checked" : ""}> ${renderFallbackInline(task[2])}</li>` : `<li>${renderFallbackInline(content)}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderFallbackInline(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^<[\w!/]/.test(line.trim())) {
      html.push(line);
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^>\s?/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${renderFallbackInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

function renderFallbackInline(value) {
  let output = escapeHtml(value);
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  output = output.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
  output = output.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  output = output.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  output = output.replace(/\+\+([^+]+)\+\+/g, "<ins>$1</ins>");
  output = output.replace(/~([^~]+)~/g, "<sub>$1</sub>");
  output = output.replace(/\^([^^]+)\^/g, "<sup>$1</sup>");
  return output;
}

function renderCodeBlock(code, language) {
  const lang = normalizeCodeLanguage(language);
  const displayLang = escapeHtml(lang);
  if (window.hljs?.getLanguage?.(lang)) {
    return `<pre class="code-block code-lang-${displayLang}" data-language="${displayLang}"><code class="hljs language-${displayLang}">${window.hljs.highlight(code, { language: lang }).value}</code></pre>`;
  }
  return `<pre class="code-block code-lang-${displayLang}" data-language="${displayLang}"><code class="language-${displayLang}">${highlightFallbackCode(code, lang)}</code></pre>`;
}

function normalizeCodeLanguage(language) {
  const lang = String(language || "plaintext").trim().toLowerCase().replace(/[^\w-]/g, "") || "plaintext";
  const aliases = {
    cplusplus: "cpp",
    cxx: "cpp",
    csharp: "cs",
    dartlang: "dart",
    golang: "go",
    javascript: "js",
    jsx: "js",
    node: "js",
    nodejs: "js",
    typescript: "ts",
    tsx: "ts",
    py: "python",
    rb: "ruby",
    rs: "rust",
    objectivec: "objc",
    "obj-c": "objc",
    octave: "matlab",
    docker: "dockerfile",
    gql: "graphql",
    shell: "bash",
    sh: "bash",
    zsh: "bash",
    ps: "powershell",
    ps1: "powershell",
    yml: "yaml"
  };
  return aliases[lang] || lang;
}

function highlightFallbackCode(code, language) {
  const escaped = escapeHtml(code);
  if (["js", "ts", "java", "cs", "cpp", "c", "go", "rust", "php", "swift", "kotlin", "dart", "scala", "objc"].includes(language)) {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;.*?&quot;|'.*?'|`[\s\S]*?`)/g, "hljs-string"],
      [/\b(\d+(?:\.\d+)?)\b/g, "hljs-number"],
      [/\b(true|false|null|undefined|None|nil)\b/g, "hljs-literal"],
      [/\b(abstract|as|assert|async|await|base|bool|break|case|catch|char|class|const|continue|covariant|default|deferred|do|double|dynamic|else|enum|export|extends|extension|external|factory|false|final|finally|float|for|from|function|get|if|implements|import|in|interface|int|is|late|let|library|match|mixin|mut|namespace|new|null|operator|package|part|private|protected|public|required|return|sealed|set|static|string|struct|super|switch|sync|this|throw|true|try|typedef|using|var|void|when|while|with|yield)\b/g, "hljs-keyword"]
    ]);
  }
  if (["r", "lua", "perl", "matlab"].includes(language)) {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;.*?&quot;|'.*?')/g, "hljs-string"],
      [/\b(\d+(?:\.\d+)?)\b/g, "hljs-number"],
      [/\b(TRUE|FALSE|NULL|NA|NaN|Inf|nil|true|false)\b/g, "hljs-literal"],
      [/\b(function|if|else|for|while|repeat|return|break|next|local|end|then|do|until|sub|my|our|use|package|begin|switch|case|otherwise|try|catch)\b/g, "hljs-keyword"]
    ]);
  }
  if (["dockerfile", "nginx", "graphql"].includes(language)) {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;.*?&quot;|'.*?')/g, "hljs-string"],
      [/#.*$/gm, "hljs-comment"],
      [/\b(FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|server|location|upstream|listen|proxy_pass|query|mutation|subscription|fragment|type|input|enum|interface|scalar|schema)\b/g, "hljs-keyword"]
    ]);
  }
  if (language === "python") {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;.*?&quot;|'.*?')/g, "hljs-string"],
      [/\b(\d+(?:\.\d+)?)\b/g, "hljs-number"],
      [/\b(True|False|None)\b/g, "hljs-literal"],
      [/\b(def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|with|lambda|yield|async|await|pass|break|continue|global|nonlocal|assert|raise)\b/g, "hljs-keyword"]
    ]);
  }
  if (["bash", "powershell"].includes(language)) {
    return applyFallbackCodeRules(escaped, [
      [/(#.*)$/gm, "hljs-comment"],
      [/(&quot;.*?&quot;|'.*?')/g, "hljs-string"],
      [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|echo|cd|ls|cat|grep|awk|sed|curl|git|npm|python|node)\b/g, "hljs-keyword"]
    ]);
  }
  if (["html", "xml"].includes(language)) {
    return escaped
      .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="hljs-name">$2</span>')
      .replace(/\s([\w:-]+)=/g, ' <span class="hljs-attr">$1</span>=')
      .replace(/(&quot;.*?&quot;)/g, '<span class="hljs-string">$1</span>');
  }
  if (["css", "scss"].includes(language)) {
    return escaped
      .replace(/([.#]?[\w-]+)(\s*\{)/g, '<span class="hljs-selector-class">$1</span>$2')
      .replace(/([\w-]+)(\s*:)/g, '<span class="hljs-attribute">$1</span>$2')
      .replace(/(:\s*)([^;{}]+)/g, '$1<span class="hljs-string">$2</span>');
  }
  if (["json", "yaml", "toml", "ini"].includes(language)) {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;[^&]+&quot;)(\s*:)/g, "hljs-attr"],
      [/(:\s*)(&quot;.*?&quot;)/g, "hljs-string"],
      [/\b(\d+(?:\.\d+)?|true|false|null)\b/g, "hljs-literal"]
    ]);
  }
  if (language === "sql") {
    return applyFallbackCodeRules(escaped, [
      [/(&quot;.*?&quot;|'.*?')/g, "hljs-string"],
      [/\b(select|from|where|join|left|right|inner|outer|on|insert|into|update|delete|create|alter|drop|table|view|index|group|by|order|having|limit|offset|as|and|or|not|null|is|in|exists)\b/gi, "hljs-keyword"]
    ]);
  }
  return escaped;
}

function applyFallbackCodeRules(source, rules) {
  const tokens = [];
  let output = source;
  for (const [pattern, className] of rules) {
    output = output.replace(pattern, (...args) => {
      const match = args[0];
      const offset = args.at(-2);
      const groups = args.slice(1, -2);
      const highlighted = groups.length > 1 && groups.some(Boolean)
        ? match.replace(groups.find(Boolean), `<span class="${className}">${groups.find(Boolean)}</span>`)
        : `<span class="${className}">${match}</span>`;
      const token = `@@CODETOKEN${tokens.length}@@`;
      tokens.push(highlighted);
      return token;
    });
  }
  return tokens.reduce((html, value, index) => html.replaceAll(`@@CODETOKEN${index}@@`, value), output);
}

function sanitizePreviewHtml(html, options) {
  if (window.DOMPurify?.sanitize) return DOMPurify.sanitize(html, options);
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function renderFallbackMath() {
  preview.querySelectorAll(".math-inline, .math-block").forEach((node) => {
    const text = node.textContent.replace(/^\\\(|\\\)$/g, "").replace(/^\\\[|\\\]$/g, "").trim();
    node.textContent = formatFallbackTeX(text);
    node.classList.add("math-fallback");
  });
}

function formatFallbackTeX(tex) {
  return tex
    .replace(/\\infty/g, "∞")
    .replace(/\\pi/g, "π")
    .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
    .replace(/\\int/g, "∫")
    .replace(/\\sum/g, "∑")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\nabla/g, "∇")
    .replace(/\\cdot/g, "·")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\to|\\rightarrow/g, "→")
    .replace(/\\left|\\right/g, "")
    .replace(/\\[,;!]/g, " ")
    .replace(/\s+/g, " ");
}

function appendFallbackFootnotes(markdown) {
  const lines = markdown.split("\n");
  const definitions = new Map();
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) {
      output.push(lines[index]);
      continue;
    }
    definitions.set(match[1], match[2]);
  }

  const used = [];
  const body = output.join("\n").replace(/\[\^([^\]]+)\]/g, (_, id) => {
    if (!definitions.has(id)) return `[^${id}]`;
    if (!used.includes(id)) used.push(id);
    const number = used.indexOf(id) + 1;
    return `<sup class="footnote-ref"><a id="fnref-${slug(id)}" href="#fn-${slug(id)}">[${number}]</a></sup>`;
  });

  if (!used.length) return body;
  const notes = used.map((id, index) => `<li class="footnote-item" id="fn-${slug(id)}" value="${index + 1}"><a class="footnote-number-backref" href="#fnref-${slug(id)}">${index + 1}.</a> ${markdownEngine.renderInline(definitions.get(id))}</li>`).join("");
  return `${body}\n\n<section class="footnotes"><ol class="footnotes-list">${notes}</ol></section>`;
}

function buildToc(markdown) {
  const headings = [...markdown.matchAll(/^(#{1,4})\s+(.+)$/gm)]
    .filter((match) => !match[2].includes("[[toc]]"))
    .map((match) => {
      const level = match[1].length;
      const text = stripMarkdown(match[2]);
      const id = slug(text);
      return { level, text, id };
    });

  if (!headings.length) return "";
  return `<nav class="toc"><strong>Contents</strong><ol>${headings.map((heading) => `<li style="margin-left:${(heading.level - 1) * 14}px"><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`).join("")}</ol></nav>`;
}

async function renderMermaid() {
  if (!window.mermaid) {
    preview.querySelectorAll("pre.mermaid").forEach((diagram) => {
      diagram.classList.add("mermaid-fallback");
    });
    return;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: darkPalette.checked ? "dark" : "default" });
  const diagrams = [...preview.querySelectorAll("pre.mermaid")];
  for (const diagram of diagrams) {
    const source = diagram.textContent;
    const id = `diagram-${crypto.randomUUID()}`;
    try {
      const result = await mermaid.render(id, source);
      const wrapper = document.createElement("div");
      wrapper.className = "diagram";
      wrapper.innerHTML = result.svg;
      diagram.replaceWith(wrapper);
    } catch (error) {
      diagram.classList.add("error");
      diagram.textContent = `Mermaid error: ${error.message}`;
    }
  }
}

async function renderMath() {
  if (window.MathJax && !window.MathJax.typesetPromise && window.MathJax.startup?.promise) {
    try {
      await window.MathJax.startup.promise;
    } catch (error) {
      console.error(error);
    }
  }
  if (!window.MathJax?.typesetPromise) {
    renderFallbackMath();
    return;
  }
  try {
    await MathJax.typesetPromise([preview]);
  } catch (error) {
    console.error(error);
    renderFallbackMath();
  }
}

function applyFormattingSettings() {
  const dimensions = getPageDimensions();
  preview.className = `preview ${previewTheme.value}`;
  preview.classList.toggle("dark", darkPalette.checked);
  document.documentElement.classList.toggle("dark-print", darkPalette.checked);
  preview.classList.toggle("wrap-code", codeWrap.checked);
  preview.classList.toggle("smart-pagination", smartPagination.checked);
  preview.style.setProperty("--preview-width", dimensions.width);
  preview.style.setProperty("--preview-min-height", dimensions.minHeight);
  preview.style.setProperty("--preview-padding", `${pageMargin.value}mm`);
  updatePrintPageStyle();
}

function getPageDimensions() {
  if (pageSize.value === "letter") return { width: "8.5in", minHeight: "11in", name: "Letter" };
  if (pageSize.value === "legal") return { width: "8.5in", minHeight: "14in", name: "Legal" };
  return { width: "210mm", minHeight: "297mm", name: "A4" };
}

function getPageContentHeight() {
  const pageHeight = getPageDimensions().minHeight;
  const pageHeightPixels = parseFloat(pageHeight) * (pageHeight.endsWith("in") ? 96 : 96 / 25.4);
  return pageHeightPixels - Number(pageMargin.value) * 2 * (96 / 25.4);
}

function updatePrintPageStyle(printMargin = darkPalette.checked ? "0" : `${pageMargin.value}mm`) {
  document.getElementById("print-page-style").textContent = `@page { size: ${getPageDimensions().name} portrait; margin: ${printMargin}; }`;
}

function updateStats(markdown) {
  const plain = stripMarkdown(markdown).trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const chars = markdown.length;
  const headings = (markdown.match(/^#{1,6}\s+/gm) || []).length;
  document.getElementById("word-count").textContent = words;
  document.getElementById("char-count").textContent = chars;
  document.getElementById("read-time").textContent = `${Math.max(1, Math.ceil(words / 220))} min`;
  document.getElementById("heading-count").textContent = headings;
}

function insertSnippet(type) {
  const snippets = {
    bold: ["**", "**", "bold text"],
    italic: ["_", "_", "italic text"],
    underline: ["++", "++", "underlined text"],
    code: ["`", "`", "code"],
    link: ["[", "](https://example.com)", "link text"],
    image: ["![", "](https://example.com/image.png)", "alt text"],
    table: ["\n| Column | Value |\n| --- | ---: |\n| Item | 1 |\n", "", ""],
    math: ["\n$$\n", "\n$$\n", "\\alpha^2 + \\beta^2 = \\gamma^2"],
    diagram: ["\n```mermaid\n", "\n```\n", "flowchart LR\n  A --> B"]
  };
  const [before, after, fallback] = snippets[type];
  wrapSelection(before, after, fallback);
}

function wrapSelection(before, after, fallback) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || fallback;
  editor.setRangeText(`${before}${selected}${after}`, start, end, "select");
  editor.focus();
  localStorage.setItem("markdown-pdf-content", editor.value);
  updateUnsavedState();
  updateLineNumbers();
  updateAutoTitle();
  render();
}

function formatMarkdown() {
  const lines = editor.value.replace(/\r\n/g, "\n").split("\n");
  const formatted = [];
  let inFence = false;
  let previousBlank = false;

  for (const rawLine of lines) {
    let line = rawLine.replace(/[ \t]+$/g, "");
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (!inFence) {
      line = line.replace(/^(#{1,6})([^\s#])/g, "$1 $2");
      line = line.replace(/^(\s*[-*+])\s{2,}/g, "$1 ");
      line = line.replace(/^(\s*\d+\.)\s{2,}/g, "$1 ");
    }
    const blank = line.trim() === "";
    if (blank && previousBlank) continue;
    formatted.push(line);
    previousBlank = blank;
  }

  editor.value = alignMarkdownTables(formatted.join("\n")).trim() + "\n";
  localStorage.setItem("markdown-pdf-content", editor.value);
  updateUnsavedState();
  updateLineNumbers();
  updateAutoTitle();
  render();
}

function alignMarkdownTables(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  return blocks.map((block) => {
    const rows = block.split("\n");
    if (rows.length < 2 || !rows.every((row) => /^\s*\|.*\|\s*$/.test(row))) return block;
    const cells = rows.map((row) => row.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
    const widths = cells[0].map((_, index) => Math.max(...cells.map((row) => (row[index] || "").length)));
    return cells.map((row, rowIndex) => {
      const padded = row.map((cell, index) => rowIndex === 1 ? normalizeSeparator(cell, widths[index]) : cell.padEnd(widths[index], " "));
      return `| ${padded.join(" | ")} |`;
    }).join("\n");
  }).join("\n\n");
}

function normalizeSeparator(cell, width) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  const dashCount = Math.max(3, width - Number(left) - Number(right));
  return `${left ? ":" : ""}${"-".repeat(dashCount)}${right ? ":" : ""}`.padEnd(width, " ");
}

function openMarkdownFile() {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = String(reader.result || "");
    localStorage.setItem("markdown-pdf-content", editor.value);
    markContentSaved();
    updateLineNumbers();
    updateAutoTitle();
    render();
  };
  reader.readAsText(file);
  fileInput.value = "";
}

function saveMarkdown() {
  updateAutoTitle();
  download(`${fileBaseName()}.md`, editor.value, "text/markdown");
  markContentSaved();
}

function saveHtml() {
  updateAutoTitle();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle.value)}</title><link rel="stylesheet" href="styles.css"></head><body><article class="${preview.className}">${preview.innerHTML}</article></body></html>`;
  download(`${fileBaseName()}.html`, html, "text/html");
  markContentSaved();
}

async function printDocument() {
  updateAutoTitle();
  await render();

  if (/\bKonqueror(?:\/|\b)/i.test(navigator.userAgent)) {
    window.alert("Konqueror does not support page-initiated printing. Use File → Print… or press Ctrl+P.");
    return;
  }

  if (smartPagination.checked && !await preparePagedDocument()) return;
  window.print();
  markContentSaved();
}

async function preparePagedDocument() {
  clearPagedDocument();
  if (typeof window.Paged?.Previewer !== "function") {
    window.alert("Smart pagination is unavailable because Paged.js did not load. Disable Smart pagination to use native browser printing.");
    return false;
  }

  await waitForPrintAssets();
  const article = preview.cloneNode(true);
  article.removeAttribute("id");
  article.classList.add("paged-source");
  const protectedSelector = 'pre, blockquote, .diagram, img, .math-block, mjx-container[display="true"]';
  const protectedBlocks = [...preview.querySelectorAll(protectedSelector)];
  const clonedBlocks = [...article.querySelectorAll(protectedSelector)];
  const pageContentHeight = getPageContentHeight();
  protectedBlocks.forEach((block, index) => {
    const limit = block.matches("pre, blockquote") ? 0.5 : 0.85;
    if (block.getBoundingClientRect().height <= pageContentHeight * limit) {
      clonedBlocks[index]?.classList.add("paged-keep-together");
    }
  });
  const headings = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const clonedHeadings = [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  headings.forEach((heading, index) => {
    const following = heading.nextElementSibling;
    if (following && following.getBoundingClientRect().height <= pageContentHeight * 0.5) {
      clonedHeadings[index]?.classList.add("paged-keep-with-next");
    }
  });
  const expectedTextLength = article.textContent.replace(/\s+/g, "").length;
  const source = document.createDocumentFragment();
  source.appendChild(article);
  detachedPreviewContent = document.createDocumentFragment();
  detachedPreviewContent.append(...preview.childNodes);
  let stylesheet;

  try {
    stylesheet = URL.createObjectURL(new Blob([getPagedStyles()], { type: "text/css" }));
    pagedPreviewer = new Paged.Previewer();
    await pagedPreviewer.preview(source, [stylesheet], pagedOutput);
    removeTrailingEmptyPages();
    const pagedTextLength = pagedOutput.textContent.replace(/\s+/g, "").length;
    if (pagedTextLength < expectedTextLength * 0.97) {
      throw new Error(`Paged output is incomplete: ${pagedTextLength}/${expectedTextLength} characters rendered.`);
    }
  } catch (error) {
    console.error(error);
    clearPagedDocument();
    window.alert("Smart pagination failed. Disable Smart pagination to use native browser printing.");
    return false;
  } finally {
    if (stylesheet) URL.revokeObjectURL(stylesheet);
  }

  document.documentElement.classList.add("paged-print");
  updatePrintPageStyle("0");
  return true;
}

function clearPagedDocument() {
  document.documentElement.classList.remove("paged-print");
  pagedOutput.replaceChildren();
  pagedPreviewer?.polisher?.inserted?.forEach((style) => style.remove());
  pagedPreviewer = null;
  if (detachedPreviewContent) {
    preview.appendChild(detachedPreviewContent);
    detachedPreviewContent = null;
  }
  updatePrintPageStyle();
}

function removeTrailingEmptyPages() {
  const pages = [...pagedOutput.querySelectorAll(".pagedjs_page")];
  while (pages.length > 1) {
    const page = pages.at(-1);
    const content = page.querySelector(".pagedjs_page_content") || page;
    const hasContent = content.textContent.trim() || content.querySelector("img, svg, table, pre, hr, mjx-container, input");
    if (hasContent) break;
    page.remove();
    pages.pop();
  }
}

async function waitForPrintAssets() {
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all([...preview.querySelectorAll("img")].map(async (image) => {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }
    if (image.decode) await image.decode().catch(() => {});
  }));
}

function getPagedStyles() {
  const pageBackground = darkPalette.checked ? "background: #181a1b;" : "";
  return `
    @page { size: ${getPageDimensions().name} portrait; margin: ${pageMargin.value}mm; ${pageBackground} }
    .preview.paged-source {
      display: block;
      width: auto;
      max-width: none;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      box-shadow: none;
      overflow: visible;
    }
    .preview.paged-source table { display: table; overflow: visible; }
    .preview.paged-source pre:not(.paged-keep-together),
    .preview.paged-source .diagram {
      overflow: visible !important;
    }
    .preview.paged-source pre:not(.paged-keep-together) {
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    .preview.paged-source pre:not(.paged-keep-together) code {
      display: block;
    }
    .preview.paged-source .diagram svg {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .preview.paged-source .paged-keep-with-next {
      break-after: avoid-page;
      page-break-after: avoid;
    }
    .preview.paged-source p,
    .preview.paged-source li {
      orphans: 2;
      widows: 2;
    }
    .preview.paged-source .paged-keep-together,
    .preview.paged-source tr {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    .preview.paged-source thead { display: table-header-group; }
    .preview.paged-source .page-break { break-after: page; }
  `;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fileBaseName() {
  return (docTitle.value || "document").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function slug(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

function stripMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|`-]/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
