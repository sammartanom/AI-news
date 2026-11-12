// Light, transparent query interpretation. It produces soft ranking hints only: nothing here
// filters results out, and every rule is a plain pattern listed below.

const RULES = [
  { re: /\b(parents?|caregivers?|famil(y|ies)|guardians?)\b/, hint: { audiences: ['Families'], collections: ['for-families'] }, label: 'families' },
  { re: /\b(superintendents?|principals?|district|administrators?|board members?|school board|leaders?|leadership)\b/, hint: { audiences: ['Administrators'], collections: ['school-district-leadership'] }, label: 'school and district leadership' },
  { re: /\b(teachers?|educators?|instructional coach(es)?)\b/, hint: { audiences: ['Teachers'] }, label: 'teachers' },
  { re: /\b(classroom|lesson plans?|activities)\b/, hint: { collections: ['inside-classroom'] }, label: 'classroom' },
  { re: /\bexamples?\b/, hint: { evidence: ['classroom_example', 'lesson_resource'] }, label: 'examples' },
  { re: /\b(students? (are )?(saying|say|think|thinks|voices?|perspectives?|views?|opinions?)|what do students|student voices?)\b/, hint: { collections: ['student-perspectives'], evidence: ['student_voice'] }, label: 'student perspectives' },
  { re: /\b(research|stud(y|ies)|evidence|findings|efficacy|peer[- ]reviewed)\b/, hint: { collections: ['research-evidence'], evidence: ['research', 'research_summary', 'survey_data'] }, label: 'research' },
  { re: /\b(skeptic\w*|sceptic\w*|concerns?|risks?|critic\w*|harms?|problems?|worr\w*|dangers?|downsides?)\b/, hint: { collections: ['questions-concerns'] }, label: 'questions and concerns' },
  { re: /\b(polic(y|ies)|governance|guidelines?|responsible use|acceptable use)\b/, hint: { collections: ['policy-governance'], evidence: ['guidance', 'policy_template'] }, label: 'policy' },
  { re: /\b(privacy|security|ferpa|coppa|data protection)\b/, hint: { collections: ['privacy-security'] }, label: 'privacy and security' },
  { re: /\b(assessment|grading|cheat\w*|academic integrity|plagiari\w*|detect(ion|ors?|ing)?)\b/, hint: { collections: ['assessment-integrity'] }, label: 'assessment' },
  { re: /\b(elementary|primary school|k-?5|k-?2|early grades|young children)\b/, hint: { collections: ['elementary-education'], grades: ['K-2', '3-5'] }, label: 'elementary' },
  { re: /\b(first|start(ing)?|begin(ning)?|introduc\w+|new to|basics?|overview)\b/, hint: { collections: ['start-here'] }, label: 'starting points' },
  { re: /\b(equity|access|digital divide|multilingual|english learners?|special education|disabilit\w+)\b/, hint: { collections: ['equity-access'] }, label: 'equity and access' }
];

const RECENT = /\b(latest|newest|recent|recently|this year|current|updates?|what'?s new|new(?! to\b))\b/;

export function parseIntent(q) {
  const s = String(q ?? '').toLowerCase();
  const intent = { audiences: [], collections: [], evidence: [], grades: [], wantsRecent: RECENT.test(s), matched: [] };
  for (const { re, hint, label } of RULES) {
    if (!re.test(s)) continue;
    intent.matched.push(label);
    for (const k of ['audiences', 'collections', 'evidence', 'grades']) {
      for (const v of hint[k] ?? []) if (!intent[k].includes(v)) intent[k].push(v);
    }
  }
  return intent;
}
