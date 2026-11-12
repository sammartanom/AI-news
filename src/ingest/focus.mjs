// Focus rules for general AI news ("AI beyond education"). The library keeps some AI news from
// outside education, but only what a teacher, school leader or parent could use: society, policy,
// safety, jobs, literacy, young people. Model launches, chips, enterprise deals and weekly ML
// digests are left out. Rules, not a model: cheap, repeatable and easy to explain.

// Never published automatically: digests, product and industry news, sponsored posts.
const OFF_FOCUS = /^import ai \d|last week in ai|\blwiai\b|\[ainews\]|^aisn #|ai safety newsletter #|\badvertis(e|ing) on\b|\benterprise\b|\bindustrial\b|\bfortune \d+|\bseries [a-e]\b|\$\d+(\.\d+)?[bm]? arr\b|\bkernels?\b|\bgpus?\b|\bchips?\b|\bdata ?cent(er|re)s?\b|\bservers?\b|\binference\b|\bbenchmark(s|ing)?\b|\bleaderboards?\b|\bstock offering\b|\bshares in\b|\bmarkets lose\b|\bsmart tvs?\b|\bads? (growth|globally)\b|\bwebgpu\b|\bdeploy it\b|\bcloud\b|\bopen weights?\b|\btoken(s|izer)?\b|\btraining runs?\b|\bquantum\b|\bsemiconductors?\b/i;

// What makes general AI news useful here.
const IN_FOCUS = /\b(kids?|child(ren)?|teens?|young|youth|students?|schools?|educat\w*|learn(ing|ers?)?|teach\w*|parents?|famil(y|ies)|classrooms?|literacy|universit(y|ies)|college|jobs?|workers?|workforce|employ\w*|elections?|democra\w*|disinformation|misinformation|deep ?fakes?|slop|companions?|chatbots?|well-?being|mental|loneliness|privacy|surveil\w*|data access|bias(ed)?|gender|equit\w*|regulat\w*|govern\w*|polic(y|ies)|laws?|legislat\w*|executive order|congress|safety|safe|risks?|harms?|trust\w*|reason(ing)?|hype|surveys?|americans|public|society|ethic\w*|writ(ing|ten|ers?)|detect\w*|watermark\w*|humanity|doom\w*|extinction|apocalypse|misus\w*|accountab\w*|transparen\w*|rights|creativ\w*|artists?|authors?|human|people|study(ing)?|kindergart\w*|companionship|kill|chatgpt|critical thinking|skills|citations?|misconduct|amplification|social media|exams?|year[- ]old|copyright|economy|economic|labor|layoffs|journalism|hallucinat\w*|conscious\w*|smart|academi\w*|maths?|textbooks?)\b/i;

// Strict sources need a direct link to learning, young people, or the public questions schools face.
const IN_FOCUS_STRICT = /\b(kids?|child(ren)?|teens?|young|youth|students?|schools?|educat\w*|learners?|teachers?|parents?|famil(y|ies)|classrooms?|literacy|universit(y|ies)|college|academi\w*|dissertations?|textbooks?|slop|deep ?fakes?|misinformation|disinformation|watermark\w*|detectors?|written|writing|ethics?|governing|governance|polic(y|ies)|laws?|regulat\w*|conscious\w*|critical thinking|skills|scams?|democra\w*|jobs?|workforce|learning with)\b/i;
const TEACHING_MACHINES = /\bteaching (ai|llms?|models?|robots?)\b/i;

// Product launches and feature news: "Google launches Gemini 4", "Apple releases iOS 27".
const LAUNCH = /\b(introduc(ing|es)|launch(es|ed)?|releases?|unveils?|is coming to|now available|start building|lets you build|adds|is ending)\b.*\b(gemini|gpt|claude|llama|copilot|siri|chrome|firefox|ios|macos|nano banana|genie|models?|app|agents?|tts|api)\b|^(gemini|gpt)[- ]?\d/i;

/**
 * Whether a general AI news title belongs. Strict sources (lab blogs, ML digests) must show an
 * educator angle; other news and opinion sources are kept unless the item is off focus.
 */
export function inFocus(title, { strict = false } = {}) {
  const t = String(title ?? '');
  if (OFF_FOCUS.test(t) || LAUNCH.test(t)) return false;
  return strict ? IN_FOCUS_STRICT.test(t) && !TEACHING_MACHINES.test(t) : true;
}
