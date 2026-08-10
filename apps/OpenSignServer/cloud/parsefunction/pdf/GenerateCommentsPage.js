import { rgb } from 'pdf-lib';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { formatDateTime } from '../../../Utils.js';

// Breaks a single unbroken run (no spaces) into pieces that each fit `width`.
// Needed for Thai, which often has no spaces to wrap on.
const forceBreakLongWord = (word, width, font, fontSize) => {
  const parts = [];
  let current = '';
  for (const char of word) {
    const lineWidth = font.widthOfTextAtSize(current + char, fontSize);
    if (lineWidth <= width) {
      current += char;
    } else {
      if (current) parts.push(current);
      current = char;
    }
  }
  if (current) parts.push(current);
  return parts;
};

// Word-wraps `text` to `width`, preserving the author's own line breaks.
const wrapText = (text, width, font, fontSize) => {
  const breakIntoLines = paragraph => {
    const lines = [];
    let currentLine = '';
    const words = paragraph.split(' ');
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth <= width) {
        currentLine = testLine;
      } else if (font.widthOfTextAtSize(word, fontSize) > width) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        forceBreakLongWord(word, width, font, fontSize).forEach(p => lines.push(p));
        currentLine = '';
      } else {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = word;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    return lines;
  };

  const finalLines = [];
  const paragraphs = (text || '').split('\n');
  for (const para of paragraphs) {
    if (font.widthOfTextAtSize(para, fontSize) <= width) {
      finalLines.push(para);
    } else {
      finalLines.push(...breakIntoLines(para));
    }
  }
  return finalLines;
};

// Appends a trailing "ความคิดเห็นเพิ่มเติม" (additional comments) section to
// `pdfDoc` — the same document being signed, not a standalone PDF like
// GenerateCertificate.js. Returns how many pages were appended, so the
// caller can strip exactly that many before regenerating on a later round.
export default async function GenerateCommentsPage(pdfDoc, docDetails, comments) {
  const timezone = docDetails?.ExtUserPtr?.Timezone || '';
  const Is12Hr = docDetails?.ExtUserPtr?.Is12HourTime || false;
  const DateFormat = docDetails?.ExtUserPtr?.DateFormat || 'MM/DD/YYYY';

  const fontBytes = fs.readFileSync('./font/sarabun.ttf');
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  const { width, height } = lastPage.getSize();

  const startX = 40;
  const startY = 40;
  const contentWidth = width - startX * 2;
  const titleColor = rgb(0, 0.2, 0.4);
  const textKeyColor = rgb(0.12, 0.12, 0.12);
  const textValueColor = rgb(0.3, 0.3, 0.3);
  const titleSize = 20;
  const subtitleSize = 12;
  const nameSize = 12;
  const dateSize = 10;
  const commentSize = 11;
  const lineHeight = 15;
  const minY = startY;

  const startPageCount = pdfDoc.getPageCount();
  let page = pdfDoc.addPage([width, height]);
  let y = height - startY;

  page.drawText('ความคิดเห็นเพิ่มเติม', {
    x: startX,
    y,
    size: titleSize,
    font,
    color: titleColor,
  });
  y -= titleSize + 10;

  page.drawText(`เอกสาร: ${docDetails?.Name || ''}`, {
    x: startX,
    y,
    size: subtitleSize,
    font,
    color: textKeyColor,
  });
  y -= subtitleSize + 25;

  const startNewPage = () => {
    page = pdfDoc.addPage([width, height]);
    y = height - startY;
  };

  for (const entry of comments || []) {
    const commentLines = wrapText(entry?.Comment || '', contentWidth, font, commentSize);
    const blockHeight = nameSize + 6 + dateSize + 10 + commentLines.length * lineHeight + 20;

    if (y - blockHeight < minY) {
      startNewPage();
    }

    page.drawText(entry?.Name || '', {
      x: startX,
      y,
      size: nameSize,
      font,
      color: titleColor,
    });
    y -= nameSize + 6;

    const signedOnLabel = entry?.SignedOn
      ? formatDateTime(new Date(entry.SignedOn), DateFormat, timezone, Is12Hr)
      : '';
    page.drawText(signedOnLabel, {
      x: startX,
      y,
      size: dateSize,
      font,
      color: textValueColor,
    });
    y -= dateSize + 10;

    for (const line of commentLines) {
      page.drawText(line, {
        x: startX,
        y,
        size: commentSize,
        font,
        color: textKeyColor,
      });
      y -= lineHeight;
    }
    y -= 20;
  }

  return pdfDoc.getPageCount() - startPageCount;
}
