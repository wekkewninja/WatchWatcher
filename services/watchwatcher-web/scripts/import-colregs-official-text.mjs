import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const sourceUrl = 'https://www.navcen.uscg.gov/navigation-rules-amalgamated';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputPath = path.join(repositoryRoot, 'services/watchwatcher-web/public/assets/reference/colregs_official_text.json');
const response = await fetch(sourceUrl, {
  headers: {
    Accept: 'text/html',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  },
});
if (!response.ok) throw new Error(`USCG source returned HTTP ${response.status}.`);

const document = new JSDOM(await response.text()).window.document;
const content = document.querySelector('.node__content');
if (!content) throw new Error('Could not find the USCG rule text container.');

const ruleHeadings = Array.from(content.querySelectorAll('strong')).flatMap((element) => {
  const match = element.textContent.trim().match(/^Rule\s+(\d+)(?:\s*[-–].*)?$/i);
  return match ? [{ number: Number(match[1]), element }] : [];
});
if (ruleHeadings.length !== 41 || ruleHeadings.some((heading, index) => heading.number !== index + 1)) {
  const labels = Array.from(content.querySelectorAll('strong')).map((element) => element.textContent.trim()).filter((text) => /rule/i.test(text)).slice(0, 20);
  throw new Error(`Expected ordered headings for Rules 1–41; found ${ruleHeadings.map(({ number }) => number).join(', ')}. Labels: ${JSON.stringify(labels)}`);
}

const sectionHeadings = Array.from(content.querySelectorAll('strong,h2,h3,h4,h5')).filter((element) =>
  /^(?:ANNEXES|AMENDMENTS AND ASSOCIATED PROVISIONS)\b/i.test(element.textContent.trim()),
);

function selectedText(text, mode, state) {
  let result = '';
  for (let index = 0; index < text.length;) {
    if (text.startsWith('‹‹', index)) {
      state.variant = 'inland';
      index += 2;
      continue;
    }
    if (text.startsWith('››', index)) {
      state.variant = null;
      index += 2;
      continue;
    }
    if (text[index] === '‹') {
      state.variant = 'international';
      index += 1;
      continue;
    }
    if (text[index] === '›') {
      state.variant = null;
      index += 1;
      continue;
    }
    if (state.variant === null || state.variant === mode) result += text[index];
    index += 1;
  }
  return result;
}

function variantColumns(table) {
  const header = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim().toLowerCase());
  if (!header.length) return null;
  const international = header.findIndex((value) => value === 'international');
  const inland = header.findIndex((value) => value === 'inland');
  if (international >= 0 && inland >= 0) return { international, inland };
  if (international >= 0) return { international, inland: -1, only: 'international' };
  if (inland >= 0) return { international: -1, inland, only: 'inland' };
  return null;
}

function serializeTable(table, mode) {
  const columns = variantColumns(table);
  const rows = Array.from(table.querySelectorAll('tr'));
  const headerRow = table.querySelector('thead tr');
  const bodyRows = rows.filter((row) => row !== headerRow && row.querySelector('td'));

  if (columns) {
    if (columns.only && columns.only !== mode) return '';
    return bodyRows.map((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > td'));
      const cell = cells[columns[mode]];
      return cell ? serializeNode(cell, mode, { variant: null }) : '';
    }).filter(Boolean).join('\n\n');
  }

  return bodyRows.map((row) => Array.from(row.querySelectorAll(':scope > td'))
    .map((cell) => serializeNode(cell, mode, { variant: null }).trim())
    .filter(Boolean)
    .join(' | ')).filter(Boolean).join('\n');
}

function serializeNode(node, mode, state) {
  if (node.nodeType === 3) return selectedText(node.nodeValue ?? '', mode, state);
  if (node.nodeType === 11) return Array.from(node.childNodes).map((child) => serializeNode(child, mode, state)).join('');
  if (node.nodeType !== 1) return '';

  const element = node;
  const tag = element.tagName;
  if (['IMG', 'SCRIPT', 'STYLE'].includes(tag)) return '';
  if (tag === 'A' && element.getAttribute('href') === '#TopOfTOC') return '';
  if (tag === 'TABLE') {
    if (/^(?:IMPLEMENTING|INTERPRETATIVE) RULE\b/i.test(element.textContent.trim())) return '';
    return `\n${serializeTable(element, mode)}\n`;
  }
  if (tag === 'BR') return '\n';

  const value = Array.from(element.childNodes).map((child) => serializeNode(child, mode, state)).join('');
  return ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag) ? `\n${value}\n` : value;
}

function paragraphsFrom(fragment, mode) {
  const text = serializeNode(fragment, mode, { variant: null })
    .replace(/\{[^{}]*\}/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2007\u202f]/g, ' ')
    .replace(/(^|\n)\s*PART\s+[A-F]\s*[-–][^\n]*/gi, '$1')
    .replace(/(^|\n)\s*(?:I|II|III)\s*[-–]\s*Conduct of Vessels[^\n]*/gi, '$1')
    .replace(/(?<!\.)\.{2}(?!\.)/g, '.')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim().replace(/\.{2,}$/, '.')).filter(Boolean);
}

function extractRule({ number, element }, nextElement) {
  const range = document.createRange();
  range.setStartAfter(element);
  if (nextElement) range.setEndBefore(nextElement);
  else {
    const followingSection = sectionHeadings.find((candidate) => (element.compareDocumentPosition(candidate) & 4) !== 0);
    if (followingSection) range.setEndBefore(followingSection);
    else range.setEndAfter(content.lastChild);
  }

  const fragment = range.cloneContents();
  const rule = {
    rule_number: `Rule ${number}`,
    international: paragraphsFrom(fragment, 'international'),
  };
  const inland = paragraphsFrom(fragment, 'inland');
  if (inland.length && ![28, 39, 40, 41].includes(number)) rule.inland = inland;
  if (!rule.international.length) throw new Error(`No International text extracted for Rule ${number}.`);
  return rule;
}

const rules = ruleHeadings.map((heading, index) => extractRule(heading, ruleHeadings[index + 1]?.element));
const sourceUpdatedMatch = document.body.textContent.match(/page\s+was\s+last\s+changed\s+on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
const sourceUpdatedOn = sourceUpdatedMatch
  ? `${sourceUpdatedMatch[3]}-${sourceUpdatedMatch[1].padStart(2, '0')}-${sourceUpdatedMatch[2].padStart(2, '0')}`
  : null;
if (!sourceUpdatedOn) throw new Error('Could not read the USCG source update date.');

const asset = {
  source_url: sourceUrl,
  source_updated_on: sourceUpdatedOn,
  checked_on: new Date().toISOString().slice(0, 10),
  rules,
};
await writeFile(outputPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf8');
console.log(`Imported International text for ${rules.length} rules; Inland text for ${rules.filter((rule) => rule.inland).length}. Source updated ${sourceUpdatedOn}.`);
