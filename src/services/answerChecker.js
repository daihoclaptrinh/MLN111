function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function checkAnswer(question, submittedAnswer) {
  if (question.type !== "multiple_choice" || !question.correctOption) {
    return {
      autoGradable: false,
      correct: null,
      points: question.points,
      message: "Cau hoi tu luan/tinh huong can GM/MC cham.",
      correctOption: question.correctOption || null,
      expectedAnswer: question.answer || question.suggestedAnswer || question.gradingGuide || null,
      explanation: question.explanation || question.suggestedAnswer || question.gradingGuide || null,
    };
  }

  const normalized = normalizeText(submittedAnswer);
  const submittedOption = normalized.match(/^[A-D]/)?.[0] || null;
  const matchedOption = question.options.find((option) => normalizeText(option.text) === normalized);
  const finalOption = submittedOption || matchedOption?.label || null;
  const correct = finalOption === question.correctOption;

  return {
    autoGradable: true,
    correct,
    points: correct ? question.points : 0,
    submittedOption: finalOption,
    correctOption: question.correctOption,
    expectedAnswer: question.answer || null,
    explanation: question.explanation || null,
  };
}

module.exports = { checkAnswer };
