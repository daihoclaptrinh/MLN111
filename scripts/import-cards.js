const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");

const rootDir = path.join(__dirname, "..");
const inputFiles = [
  "TrietChien_TracNghiem_Batch1_La01-10.docx",
  "TrietChien_TracNghiem_Batch2_La11-20.docx",
  "TrietChien_TracNghiem_Batch3_La21-30.docx",
  "TrietChien_TracNghiem_Batch4_La31-40.docx",
];

const difficultyMap = [
  ["easy", /DỄ/i],
  ["medium", /TRUNG BÌNH/i],
  ["hard", /(KHÓ|BOSS)/i],
];

function clean(value) {
  return String(value || "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDifficulty(meta) {
  const difficulty = difficultyMap.find(([, pattern]) => pattern.test(meta))?.[0] || "hard";
  const points = Number(meta.match(/(\d+)\s*đ/i)?.[1] || (difficulty === "hard" ? 3 : 1));

  let type = "essay";
  if (/TRẮC NGHIỆM/i.test(meta)) type = "multiple_choice";
  else if (/TÌNH HUỐNG/i.test(meta)) type = "situation";
  else if (/CÂU MỞ|BOSS/i.test(meta)) type = "open";

  return { difficulty, points, type };
}

function finishQuestion(question) {
  if (!question) return null;

  if (question.correctOption && !question.answer) {
    const correct = question.options.find((option) => option.label === question.correctOption);
    question.answer = correct ? `${question.correctOption}. ${correct.text}` : question.correctOption;
    question.explanation = question.answer;
  }

  for (const field of ["text", "answer", "explanation", "suggestedAnswer", "gradingGuide"]) {
    if (question[field]) {
      question[field] = clean(question[field]);
    }
  }

  return question;
}

function parseQuestionBlock(lines, index) {
  const match = lines[index].match(/^([🟢🟡🔴])\s*\[(.+?)\]\s*(.*)$/u);
  if (!match) return null;

  const parsed = parseDifficulty(match[2]);
  const question = {
    difficulty: parsed.difficulty,
    points: parsed.points,
    type: parsed.type,
    label: clean(match[2]),
    text: clean(match[3]),
    options: [],
  };

  let cursor = index + 1;
  let appendTarget = null;
  let lastOptionIndex = -1;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (/^(?:🔥\s*)?LÁ\s+\d+\s+[—-]/i.test(line) || /^[🟢🟡🔴]\s*\[/u.test(line)) {
      break;
    }

    const optionMatch = line.match(/^•\s*([A-D])\.\s*(.+)$/i);
    const answerMatch = line.match(/^✅\s*Đáp án:\s*([A-D])?\s*(?:[—-]\s*)?(.*)$/i);
    const suggestionMatch = line.match(/^Gợi ý đáp án:\s*(.+)$/i);
    const guideMatch = line.match(/^Hướng dẫn chấm:\s*(.+)$/i);
    const rubricMatch = line.match(/^Thang điểm:\s*(.+)$/i);

    if (optionMatch) {
      question.options.push({ label: optionMatch[1].toUpperCase(), text: clean(optionMatch[2]) });
      lastOptionIndex = question.options.length - 1;
      appendTarget = null;
    } else if (answerMatch) {
      if (answerMatch[1]) {
        question.correctOption = answerMatch[1].toUpperCase();
      }
      question.answer = clean(answerMatch[2]);
      question.explanation = clean(answerMatch[2]);
      appendTarget = "explanation";
    } else if (suggestionMatch) {
      question.suggestedAnswer = clean(suggestionMatch[1]);
      appendTarget = "suggestedAnswer";
    } else if (guideMatch) {
      question.gradingGuide = clean(guideMatch[1]);
      appendTarget = "gradingGuide";
    } else if (rubricMatch) {
      question.gradingGuide = clean(`${question.gradingGuide || ""} ${line}`);
      appendTarget = "gradingGuide";
    } else if (appendTarget) {
      question[appendTarget] = clean(`${question[appendTarget] || ""} ${line}`);
    } else if (lastOptionIndex >= 0 && !/^✅|^Gợi ý|^Hướng dẫn|^Thang điểm/i.test(line)) {
      question.options[lastOptionIndex].text = clean(`${question.options[lastOptionIndex].text} ${line}`);
    } else if (!/^📊|^🎴|^Batch$|^Tổng$/i.test(line)) {
      question.text = clean(`${question.text} ${line}`);
    }

    cursor += 1;
  }

  if (question.type === "multiple_choice" && question.options.length === 0) {
    question.type = "essay";
  }

  if (question.options.length > 0) {
    question.type = "multiple_choice";
  }

  return { question: finishQuestion(question), nextIndex: cursor };
}

function parseCardsFromLines(lines, sourceFile) {
  const cards = [];
  let current = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const cardMatch = line.match(/^(?:🔥\s*)?LÁ\s+(\d+)\s+[—-]\s+(.+)$/i);

    if (cardMatch) {
      if (current) cards.push(current);
      const number = Number(cardMatch[1]);
      current = {
        code: `TH${String(number).padStart(2, "0")}`,
        number,
        title: clean(cardMatch[2]),
        situation: "",
        sourceFile,
        questions: [],
      };
      index += 1;
      continue;
    }

    if (!current) {
      index += 1;
      continue;
    }

    const situationMatch = line.match(/^TÌNH HUỐNG:\s*(.+)$/i);
    if (situationMatch) {
      current.situation = clean(situationMatch[1]);
      index += 1;
      continue;
    }

    if (/^[🟢🟡🔴]\s*\[/u.test(line)) {
      const parsed = parseQuestionBlock(lines, index);
      if (!parsed) {
        throw new Error(`Cannot parse question near ${current.code}: ${line}`);
      }
      current.questions.push(parsed.question);
      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  if (current) cards.push(current);
  return cards;
}

async function extractLines(fileName) {
  const filePath = path.join(rootDir, fileName);
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter(Boolean);
}

async function main() {
  const parsedCards = [];

  for (const fileName of inputFiles) {
    const lines = await extractLines(fileName);
    parsedCards.push(...parseCardsFromLines(lines, fileName));
  }

  parsedCards.sort((a, b) => a.number - b.number);

  const errors = [];
  if (parsedCards.length !== 40) {
    errors.push(`Expected 40 cards, got ${parsedCards.length}`);
  }

  for (const card of parsedCards) {
    if (card.questions.length !== 3) {
      errors.push(`${card.code} has ${card.questions.length} questions`);
    }
    for (const question of card.questions) {
      if (question.type !== "multiple_choice") {
        errors.push(`${card.code} ${question.difficulty} is ${question.type}, expected multiple_choice`);
      }
      if (question.options.length !== 4) {
        errors.push(`${card.code} ${question.difficulty} has ${question.options.length} options`);
      }
      if (!question.correctOption) {
        errors.push(`${card.code} ${question.difficulty} missing correctOption`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const outputDir = path.join(rootDir, "data");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "cards.json"), `${JSON.stringify(parsedCards, null, 2)}\n`, "utf8");

  console.log(`Imported ${parsedCards.length} cards and ${parsedCards.reduce((sum, card) => sum + card.questions.length, 0)} questions.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
