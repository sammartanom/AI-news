// Rule-based topic tagging. Each topic is a set of phrases; a resource gets every topic whose
// phrases appear in its title or descriptive text. Rules, not a model, so tags are cheap,
// repeatable and explainable. Editors' own tags are never replaced, only added to when empty.
import { COLLECTIONS, TOPICS } from './taxonomy.mjs';

export const TOPIC_RULES = {
  'ai-literacy': /\bai literacy\b|\bai[- ]literate\b|\bteach(ing)? (students |kids )?about ai\b|\bunderstand(ing)? (how )?ai\b|\bhow (does )?ai works?\b|\bai (basics|explained|101|curriculum|education framework)\b|\bai4k12\b|\bday of ai\b|\bfive big ideas\b|\bmachine learning for kids\b|\bteachable machine\b/i,
  assessment: /(?<!(risk|symptom|impact|self|needs) )\bassess(ment|ments|ing)?\b|\bgrading\b|\bgrades\b|\bmarking\b|\bfeedback\b|\bexams?\b|\btests? (scores?|prep)\b|\brubrics?\b|\bhomework\b/i,
  'academic-integrity': /\bacademic (integrity|honesty|dishonesty|misconduct)\b|\bcheat(ing|ers?)?\b|\bplagiari[sz](m|e|ing)\b|\bai use (policy|policies|scale)\b|\bai assessment scale\b/i,
  'ai-detection': /\bai[- ]detect(ion|ors?|ing)?\b|\bdetect(ing|ors?|ion) (ai|chatgpt|gpt)\b|\bturnitin\b|\bgptzero\b|\bwatermark/i,
  privacy: /\bprivacy\b|\bstudent data\b|\bdata (protection|security|governance)\b|\bferpa\b|\bcoppa\b|\bgdpr\b|\bsurveillance\b|\bcybersecurity\b|\bsecurity\b/i,
  'student-agency': /\bstudent (voice|voices|agency|perspectives?|views?|attitudes?|use|survey)\b|\bstudents (say|think|use|are using|want|feel)\b|\byouth (voice|perspectives?|views?)\b|\bteens? (say|use|and ai)\b|\bwhat (students|teens|kids) (think|say)\b/i,
  writing: /\b(student|students'?|academic|teaching|teach|ai|second language) writ(ing|ers?)\b|\bwriting (instruction|classroom|class|assignments?|feedback|centers?|skills|process|teachers?|pedagogy|assessment|improvement|tasks?)\b|\bessays\b|\bessay (writing|assignments?|questions?|task)\b|\bcomposition\b|\b(reading|literacy) (instruction|class|comprehension|skills|support)\b|\bk-3 reading\b|\bactive reading\b|\breading class\b/i,
  'ai-tutoring': /\btutor(s|ing|ed)?\b|\bpersonali[sz]ed learning\b|\bkhanmigo\b|\bai (teaching )?assistants? for students\b|\bsocratic\b/i,
  'media-literacy': /\bmedia literacy\b|\bnews literacy\b|\bmisinformation\b|\bdisinformation\b|\bdeep ?fakes?\b|\bsynthetic media\b|\bfact[- ]check|\bcritical thinking about (ai|media)\b|\bai[- ]generated (images?|content|video)\b/i,
  'professional-learning': /\bprofessional (learning|development)\b|\bteacher (training|prep|preparation|education)\b|\bpd\b|\bupskill|\bcourse for (teachers|educators)\b|\btraining (teachers|educators|staff)\b|\bworkshops?\b|\bwebinars?\b/i,
  'policy-guidance': /\bpolic(y|ies)\b|\bguidance\b|\bguidelines?\b|\b(policy|ai|readiness|literacy|strategic|guidance|governance) framework\b|\bregulat(ion|ions|ory|e|ing)\b|\bgovernance\b|\bexecutive order\b|\bstate (law|legislat)|\bbills?\b|\blegislat(ion|ure|ive)\b|\bai act\b|\bdepartment of education\b|\bacceptable use\b|\bsyllabus statements?\b/i,
  'safety-wellbeing': /\b(child|children's|kids'?|teen|youth|student|online|school|product) safety\b|\bsafe(ly)? (and (effective|responsible)|use)\b|\bschool[- ]safe\b|\bwell[- ]?being\b|\bmental health\b|\bcompanions?\b|\bloneliness\b|\bself[- ]harm\b|\bsuicid|\bparental controls?\b|\bscreen time\b|\bbullying\b|\bguardrails\b|\bsafeguarding\b/i,
  accessibility: /\baccessib(le|ility)\b|\bspecial (education|needs)\b|\bdisabilit(y|ies)\b|\budl\b|\buniversal design\b|\bneurodiver|\bdyslexi|\bautis|\biep\b|\bassistive\b|\bmultilingual\b|\benglish learners?\b|\bells?\b/i,
  equity: /\bequit(y|able)\b|\bdigital divide\b|\bbias(es|ed)?\b|\bfair(ness)?\b|\binclusi(on|ve)\b|\brural\b|\blow[- ]income\b|\bopportunity gap\b|\baccess gap\b|\bunderserved\b/i,
  'teacher-practice': /\blesson (plan|plans|planning|ideas)\b|\bclassroom\b|\bteachers? (use|using|are using|guide)\b|\bfor teachers\b|\bteacher workload\b|\btime[- ]saving\b|\bprompts? for (teachers|educators)\b|\bin the classroom\b|\bteaching with (ai|chatgpt)\b|\bactivities\b/i,
  'computer-science': /\bcomputer science\b|\bcomputing (education|curriculum)\b|\bcoding\b|\bprogramming\b|\bcs education\b|\bcode\.org\b|\bapp inventor\b|\bscratch\b|\bpython\b/i,
  'future-of-work': /\bjobs?\b|\bworkforce\b|\bcareers?\b|\bfuture of work\b|\bemploy(ment|ers?)\b|\blabor market\b|\bskills (gap|for the future)\b|\bcareer readiness\b/i
};


// Every rule names a topic in the taxonomy (checked in test/unit/topics.test.mjs).
export const TOPIC_SLUGS = TOPICS.map((t) => t.slug);

// Collection to topic: a collection an editor chose is strong evidence for the matching topic.
const COLLECTION_TOPIC = {
  'ai-literacy': 'ai-literacy',
  'assessment-integrity': 'academic-integrity',
  'privacy-security': 'privacy',
  'policy-governance': 'policy-guidance',
  'professional-learning': 'professional-learning',
  'equity-access': 'equity',
  'media-literacy': 'media-literacy',
  'student-perspectives': 'student-agency',
  'inside-classroom': 'teacher-practice'
};

// Topic to collection, used only to fill a resource that has no collection at all.
export const TOPIC_COLLECTION = {
  'ai-literacy': 'ai-literacy',
  assessment: 'assessment-integrity',
  'academic-integrity': 'assessment-integrity',
  'ai-detection': 'assessment-integrity',
  privacy: 'privacy-security',
  'policy-guidance': 'policy-governance',
  'professional-learning': 'professional-learning',
  equity: 'equity-access',
  accessibility: 'equity-access',
  'media-literacy': 'media-literacy',
  'student-agency': 'student-perspectives',
  'teacher-practice': 'inside-classroom',
  'ai-tutoring': 'learning-thinking',
  writing: 'learning-thinking',
  'safety-wellbeing': 'questions-concerns'
};
const collectionSlugs = new Set(COLLECTIONS.map((c) => c.slug));

const MAX_TOPICS = 4;

/** Topics for a resource, most specific first. `text` is any descriptive text (brief, why, best for). */
export function inferTopics({ title = '', text = '', collections = [] } = {}) {
  const hay = `${title} ${text}`.replace(/\s+/g, ' ');
  const found = [];
  for (const c of collections) if (COLLECTION_TOPIC[c] && !found.includes(COLLECTION_TOPIC[c])) found.push(COLLECTION_TOPIC[c]);
  // Title matches first: they say what the item is about, not what it mentions in passing.
  for (const [slug, re] of Object.entries(TOPIC_RULES)) if (re.test(title) && !found.includes(slug)) found.push(slug);
  for (const [slug, re] of Object.entries(TOPIC_RULES)) if (text && re.test(hay) && !found.includes(slug)) found.push(slug);
  return found.slice(0, MAX_TOPICS);
}

/** A collection for a resource that has none, from its first topic that maps to one. */
export function inferCollection(topics) {
  for (const t of topics) if (TOPIC_COLLECTION[t] && collectionSlugs.has(TOPIC_COLLECTION[t])) return TOPIC_COLLECTION[t];
  return null;
}
