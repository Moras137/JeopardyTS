const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'frontend');

function walkHtmlFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(fullPath);
    }
  }
  return out;
}

function getLineCol(text, index) {
  const before = text.slice(0, index);
  const lines = before.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

function parseAttributes(attrText) {
  const attrs = [];
  const len = attrText.length;
  let i = 0;

  while (i < len) {
    while (i < len && /\s/.test(attrText[i])) i += 1;
    if (i >= len) break;

    const nameStart = i;
    while (i < len && /[^\s=>/]/.test(attrText[i])) i += 1;
    const name = attrText.slice(nameStart, i);
    if (!name) {
      i += 1;
      continue;
    }

    while (i < len && /\s/.test(attrText[i])) i += 1;

    if (attrText[i] === '=') {
      i += 1;
      while (i < len && /\s/.test(attrText[i])) i += 1;

      if (i < len && (attrText[i] === '"' || attrText[i] === "'")) {
        const quote = attrText[i];
        i += 1;
        while (i < len && attrText[i] !== quote) i += 1;
        if (i < len && attrText[i] === quote) i += 1;
      } else {
        while (i < len && /[^\s>]/.test(attrText[i])) i += 1;
      }
    }

    attrs.push({ name, offset: nameStart });
  }

  return attrs;
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    if (text[i] !== '<') {
      i += 1;
      continue;
    }

    const next = text[i + 1];
    if (!next) break;

    if (next === '/' || next === '!' || next === '?') {
      const end = text.indexOf('>', i + 1);
      i = end === -1 ? len : end + 1;
      continue;
    }

    if (!/[A-Za-z]/.test(next)) {
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < len && /[A-Za-z0-9:-]/.test(text[j])) j += 1;
    const tagName = text.slice(i + 1, j);
    const attrStart = j;

    let inQuote = null;
    while (j < len) {
      const ch = text[j];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
        j += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inQuote = ch;
        j += 1;
        continue;
      }

      if (ch === '>') break;
      j += 1;
    }

    if (j >= len || text[j] !== '>') {
      i += 1;
      continue;
    }

    const attrText = text.slice(attrStart, j);
    const attrs = parseAttributes(attrText);

    const seen = new Map();
    for (const attr of attrs) {
      const key = attr.name.toLowerCase();
      if (seen.has(key)) {
        const attrAbsoluteIndex = attrStart + attr.offset;
        const loc = getLineCol(text, attrAbsoluteIndex);
        issues.push({
          filePath,
          line: loc.line,
          col: loc.col,
          tagName,
          attribute: attr.name
        });
      } else {
        seen.set(key, true);
      }
    }

    i = j + 1;
  }

  return issues;
}

if (!fs.existsSync(TARGET_DIR)) {
  console.error('validate:html: target directory not found:', TARGET_DIR);
  process.exit(2);
}

const files = walkHtmlFiles(TARGET_DIR);
let allIssues = [];
for (const file of files) {
  allIssues = allIssues.concat(scanFile(file));
}

if (allIssues.length > 0) {
  console.error('validate:html failed. Duplicate attributes found:');
  for (const issue of allIssues) {
    const rel = path.relative(ROOT, issue.filePath).replace(/\\/g, '/');
    console.error(
      `${rel}:${issue.line}:${issue.col} duplicate attribute "${issue.attribute}" in <${issue.tagName}>`
    );
  }
  process.exit(1);
}

console.log(`validate:html passed. Checked ${files.length} HTML file(s).`);
