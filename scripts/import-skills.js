const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");

const rootDir = path.join(__dirname, "..");
const candidateFiles = ["Kỹ_Năng&Biến_Cố.docx", path.join("nội dung bài", "Kỹ_Năng&Biến_Cố.docx")];
const skillsPath = path.join(rootDir, "data", "skills.json");

const automationByCode = {
  KN02: "steal_one",
  KN04: "self_plus_five",
  KN06: "self_plus_one",
  KN11: "manual",
  KN15: "both_plus_one",
};

const targetRequiredByCode = {
  KN02: true,
  KN03: true,
  KN08: true,
  KN09: true,
  KN13: true,
  KN15: true,
};

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/AI Giám Khảo/gi, "GM")
    .replace(/AI chọn/gi, "GM chọn")
    .trim();
}

function cleanTitle(value) {
  return clean(value)
    .replace(/\s*\([^)]*lá[^)]*\)\s*$/i, "")
    .trim()
    .toUpperCase();
}

function stripPrefix(value, prefix) {
  return clean(value.replace(prefix, ""));
}

async function findLatestInputFile() {
  const existing = [];

  for (const file of candidateFiles) {
    const fullPath = path.join(rootDir, file);
    try {
      const stat = await fs.stat(fullPath);
      existing.push({ file, fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore missing optional source files.
    }
  }

  if (existing.length === 0) {
    throw new Error("Missing Kỹ_Năng&Biến_Cố.docx source file");
  }

  existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return existing[0];
}

async function parseSkillsFromDocx(input) {
  const { value } = await mammoth.extractRawText({ path: input.fullPath });
  const lines = value
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const skills = [];
  let current = null;

  for (const line of lines) {
    if (/^PHẦN B:/i.test(line)) break;

    const skillMatch = line.match(/^KỸ\s*NĂNG\s*(\d+)\s*[–-]\s*(.+)$/i);
    if (skillMatch) {
      if (current) skills.push(current);
      const number = Number(skillMatch[1]);
      current = {
        code: `KN${String(number).padStart(2, "0")}`,
        number,
        title: cleanTitle(skillMatch[2]),
        timing: "",
        effect: "",
      };
      continue;
    }

    if (!current) continue;

    if (/^Hiệu ứng:/i.test(line)) {
      current.effect = stripPrefix(line, /^Hiệu ứng:\s*/i);
    } else if (/^Thời điểm dùng:/i.test(line)) {
      current.timing = stripPrefix(line, /^Thời điểm dùng:\s*/i);
    }
  }

  if (current) skills.push(current);
  return skills.filter((skill) => skill.effect);
}

async function main() {
  const input = await findLatestInputFile();
  const parsedSkills = await parseSkillsFromDocx(input);

  if (parsedSkills.length === 0) {
    throw new Error(`No skills found in ${input.file}`);
  }

  const skills = parsedSkills.map((skill) => ({
    ...skill,
    automation: automationByCode[skill.code] || "manual",
    requiresTarget: Boolean(targetRequiredByCode[skill.code]),
  }));

  await fs.writeFile(skillsPath, `${JSON.stringify(skills, null, 2)}\n`, "utf8");

  const warning = skills.length === 20 ? "" : " Source doc does not contain 20 usable skill entries.";
  console.log(`Imported ${skills.length} skills from ${input.file}.${warning}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
