// Education vocabulary: the words people search with and the words resources use for the same
// thing. Used to widen keyword search, so "cheating" also finds "academic integrity". Kept short
// and specific; the AI query step handles everything broader.
export const SYNONYMS = {
  cheating: ['academic integrity', 'plagiarism'],
  cheat: ['academic integrity', 'plagiarism'],
  plagiarism: ['academic integrity', 'cheating'],
  'academic integrity': ['cheating', 'plagiarism'],
  iep: ['special education', 'disabilities'],
  sped: ['special education', 'disabilities'],
  'special needs': ['special education', 'disabilities'],
  disability: ['accessibility', 'special education'],
  disabilities: ['accessibility', 'special education'],
  ell: ['english learners', 'multilingual'],
  ells: ['english learners', 'multilingual'],
  esl: ['english learners', 'multilingual'],
  multilingual: ['english learners'],
  pd: ['professional development', 'professional learning'],
  'teacher training': ['professional learning', 'professional development'],
  parent: ['families', 'family'],
  parents: ['families', 'family'],
  family: ['parents'],
  families: ['parents'],
  kids: ['children'],
  children: ['kids'],
  teens: ['teenagers', 'adolescents', 'youth'],
  teen: ['teenagers', 'adolescents', 'youth'],
  teenagers: ['teens', 'adolescents'],
  genai: ['generative ai'],
  llm: ['large language model', 'chatbot'],
  llms: ['large language models', 'chatbots'],
  chatbot: ['chatbots', 'chatgpt'],
  chatbots: ['chatbot', 'companions'],
  companion: ['companions', 'chatbots'],
  detector: ['ai detection', 'detectors'],
  detectors: ['ai detection', 'detector'],
  policy: ['guidance', 'guidelines'],
  policies: ['guidance', 'guidelines'],
  guidance: ['policy', 'guidelines'],
  law: ['legislation', 'bill'],
  laws: ['legislation', 'bills'],
  legislation: ['law', 'bill'],
  bill: ['legislation', 'law'],
  bills: ['legislation', 'laws'],
  ferpa: ['student privacy', 'privacy'],
  coppa: ['children privacy', 'privacy'],
  privacy: ['data protection'],
  grading: ['assessment', 'feedback'],
  grades: ['assessment', 'grading'],
  assessment: ['grading'],
  elementary: ['primary', 'k-5'],
  primary: ['elementary'],
  deepfake: ['deepfakes', 'synthetic media'],
  deepfakes: ['deepfake', 'synthetic media'],
  tutor: ['tutoring'],
  tutors: ['tutoring'],
  tutoring: ['tutor'],
  lesson: ['lessons', 'curriculum'],
  'lesson plans': ['lessons', 'lesson planning'],
  curriculum: ['lessons'],
  safety: ['wellbeing', 'safeguarding'],
  'mental health': ['wellbeing'],
  wellbeing: ['mental health', 'well-being'],
  ethics: ['responsible ai', 'bias'],
  bias: ['equity', 'fairness'],
  jobs: ['careers', 'workforce'],
  careers: ['jobs', 'workforce'],
  coding: ['computer science', 'programming'],
  programming: ['computer science', 'coding'],
  math: ['mathematics'],
  maths: ['mathematics', 'math'],
  mathematics: ['math'],
  principal: ['school leaders', 'administrators'],
  principals: ['school leaders', 'administrators'],
  superintendent: ['district leaders', 'administrators'],
  admin: ['administrators', 'school leaders'],
  procurement: ['vetting', 'evaluating tools'],
  vetting: ['procurement', 'evaluation']
};

// At most this many extra phrases, so a long question does not turn into a very wide search.
const MAX_EXTRA = 8;

/** Extra phrases for a search, in the order the matching words appear. */
export function synonymsFor(q) {
  const text = ` ${String(q ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const out = [];
  const seen = new Set();
  const keys = Object.keys(SYNONYMS).map((k) => ({ k, at: text.indexOf(` ${k} `) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  for (const { k } of keys) {
    for (const s of SYNONYMS[k]) {
      if (seen.has(s) || text.includes(` ${s} `)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= MAX_EXTRA) return out;
    }
  }
  return out;
}
