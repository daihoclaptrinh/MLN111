const fs = require("node:fs");
const path = require("node:path");

const skillsPath = path.join(__dirname, "../../data/skills.json");

function loadSkills() {
  if (!fs.existsSync(skillsPath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(skillsPath, "utf8"));
}

const skills = loadSkills();

function findSkill(code) {
  return skills.find((skill) => skill.code === String(code || "").trim().toUpperCase());
}

module.exports = {
  skills,
  findSkill,
};
