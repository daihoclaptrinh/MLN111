const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");

const rootDir = path.join(__dirname, "..");
const inputFile = path.join("nội dung bài", "Kỹ_Năng&Biến_Cố.docx");
const eventsPath = path.join(rootDir, "data", "events.json");

const automationByCode = {
  BC01: "all_minus_one",
  BC05: "lowest_plus_two",
};

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/AI Giám Khảo/gi, "GM")
    .replace(/AI chọn/gi, "GM chọn")
    .trim();
}

function stripPrefix(value, prefix) {
  return clean(value.replace(prefix, ""));
}

async function parseEventsFromDocx() {
  const { value } = await mammoth.extractRawText({ path: path.join(rootDir, inputFile) });
  const lines = value
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => /^PHẦN B:/i.test(line));
  const eventLines = startIndex >= 0 ? lines.slice(startIndex) : lines;

  const events = [];
  let current = null;

  for (const line of eventLines) {
    const eventMatch = line.match(/^BIẾN CỐ\s+(\d+)\s+[–-]\s+(.+)$/i);
    if (eventMatch) {
      if (current) events.push(current);
      current = {
        code: `BC${String(Number(eventMatch[1])).padStart(2, "0")}`,
        number: Number(eventMatch[1]),
        title: clean(eventMatch[2]).toUpperCase(),
        status: "",
        effect: "",
        implementationNote: "",
      };
      continue;
    }

    if (!current) continue;

    if (/^Trạng thái:/i.test(line)) {
      current.status = stripPrefix(line, /^Trạng thái:\s*/i);
    } else if (/^Hiệu ứng:/i.test(line)) {
      current.effect = stripPrefix(line, /^Hiệu ứng:\s*/i);
    } else if (/^>>\s*Gợi ý triển khai:/i.test(line)) {
      current.implementationNote = stripPrefix(line, /^>>\s*Gợi ý triển khai:\s*/i);
    }
  }

  if (current) events.push(current);
  return events.filter((event) => event.effect);
}

async function main() {
  const existingEvents = JSON.parse(await fs.readFile(eventsPath, "utf8"));
  const existingByNumber = new Map(existingEvents.map((event) => [event.number, event]));
  const parsedByNumber = new Map((await parseEventsFromDocx()).map((event) => [event.number, event]));

  const events = [];
  for (let number = 1; number <= 15; number += 1) {
    const event = parsedByNumber.get(number) || existingByNumber.get(number);
    if (!event) {
      throw new Error(`Missing event BC${String(number).padStart(2, "0")}`);
    }
    events.push({
      ...event,
      code: `BC${String(number).padStart(2, "0")}`,
      number,
      title: clean(event.title).toUpperCase(),
      effect: clean(event.effect),
      implementationNote: clean(event.implementationNote),
      automation: automationByCode[`BC${String(number).padStart(2, "0")}`] || "manual",
    });
  }

  await fs.writeFile(eventsPath, `${JSON.stringify(events, null, 2)}\n`, "utf8");
  console.log(`Imported ${events.length} events from ${inputFile}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
