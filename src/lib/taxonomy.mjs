// Controlled vocabularies. Collections and topics are also seeded in migrations;
// test/unit/taxonomy.test.mjs checks that the two stay in sync.

export const AUDIENCES = ['Everyone', 'Teachers', 'Administrators', 'Families', 'Students'];

export const COLLECTIONS = [
  { slug: 'start-here', name: 'Start here' },
  { slug: 'ai-literacy', name: 'AI literacy' },
  { slug: 'learning-thinking', name: 'Learning and thinking' },
  { slug: 'inside-classroom', name: 'Inside the classroom' },
  { slug: 'assessment-integrity', name: 'Assessment and academic integrity' },
  { slug: 'for-families', name: 'For families' },
  { slug: 'student-perspectives', name: 'Student perspectives' },
  { slug: 'school-district-leadership', name: 'School and district leadership' },
  { slug: 'privacy-security', name: 'Privacy and security' },
  { slug: 'policy-governance', name: 'Policy and governance' },
  { slug: 'professional-learning', name: 'Professional learning' },
  { slug: 'equity-access', name: 'Equity and access' },
  { slug: 'media-literacy', name: 'Media literacy and misinformation' },
  { slug: 'elementary-education', name: 'Elementary education' },
  { slug: 'research-evidence', name: 'Research and evidence' },
  { slug: 'questions-concerns', name: 'Questions, concerns, and critical perspectives' },
  { slug: 'ai-beyond-education', name: 'AI beyond education' }
];

export const TOPICS = [
  { slug: 'ai-literacy', name: 'AI literacy', query: 'AI literacy' },
  { slug: 'assessment', name: 'Assessment', query: 'assessment and AI' },
  { slug: 'academic-integrity', name: 'Academic integrity', query: 'academic integrity and AI' },
  { slug: 'privacy', name: 'Privacy and data', query: 'student data privacy and AI' },
  { slug: 'student-agency', name: 'Student voice', query: 'student voice and AI' },
  { slug: 'writing', name: 'Writing and reading', query: 'AI and student writing' },
  { slug: 'ai-detection', name: 'AI detection', query: 'AI detection tools' },
  { slug: 'ai-tutoring', name: 'Tutoring and personalized learning', query: 'AI tutoring' },
  { slug: 'media-literacy', name: 'Media literacy', query: 'media literacy and AI' },
  { slug: 'professional-learning', name: 'Professional learning', query: 'professional learning about AI for educators' },
  { slug: 'policy-guidance', name: 'Policy and guidance', query: 'AI policy and guidance for schools' },
  { slug: 'safety-wellbeing', name: 'Safety and wellbeing', query: 'AI chatbots, child safety and wellbeing' },
  { slug: 'accessibility', name: 'Accessibility and special education', query: 'AI, accessibility and special education' },
  { slug: 'equity', name: 'Equity and bias', query: 'AI equity and bias in education' },
  { slug: 'teacher-practice', name: 'Classroom practice', query: 'using AI in the classroom' },
  { slug: 'computer-science', name: 'Computer science', query: 'computer science education and AI' },
  { slug: 'future-of-work', name: 'Jobs and the future of work', query: 'AI, jobs and careers' }
];
export const topicName = (slug) => TOPICS.find((t) => t.slug === slug)?.name ?? slug;

export const GRADE_BANDS = ['Pre-K', 'K-2', '3-5', '6-8', '9-12', 'Higher education', 'All grades'];

// Content types ("format"). Free text is allowed so legacy values survive; these are suggestions.
export const FORMATS = [
  'Article', 'Report', 'Guidance', 'Framework', 'Toolkit', 'Lessons', 'Course', 'Podcast', 'Video',
  'Research paper', 'Glossary', 'Template', 'Checklist', 'Brief', 'Collection', 'Interactive tool',
  'Legislation', 'Tracker'
];

// Broad kinds for browsing. Each groups several formats; "articles" also takes anything unlisted.
export const KINDS = [
  { slug: 'articles', name: 'Articles', formats: ['Article', 'Brief'] },
  { slug: 'guides', name: 'Guides', formats: ['Guidance', 'Framework', 'Toolkit', 'Template', 'Checklist', 'Glossary'] },
  { slug: 'lessons', name: 'Lessons', formats: ['Lessons', 'Collection'] },
  { slug: 'courses', name: 'Courses', formats: ['Course'] },
  { slug: 'tools', name: 'Tools', formats: ['Interactive tool'] },
  { slug: 'videos', name: 'Videos', formats: ['Video'] },
  { slug: 'podcasts', name: 'Podcasts', formats: ['Podcast'] },
  { slug: 'research', name: 'Research', formats: ['Report', 'Research paper'] },
  { slug: 'laws', name: 'Laws and policy', formats: ['Legislation', 'Tracker'] }
];
export const kindOfFormat = (format) => KINDS.find((k) => k.formats.some((f) => f.toLowerCase() === String(format ?? '').toLowerCase()))?.slug ?? 'articles';

// Evidence / resource type: what kind of material this is, not how good it is.
export const EVIDENCE_TYPES = [
  { slug: 'research', name: 'Research study' },
  { slug: 'research_summary', name: 'Research summary' },
  { slug: 'survey_data', name: 'Survey or data report' },
  { slug: 'guidance', name: 'Guidance' },
  { slug: 'framework', name: 'Framework' },
  { slug: 'policy_template', name: 'Policy or template' },
  { slug: 'legislation', name: 'Law or regulation' },
  { slug: 'classroom_example', name: 'Classroom example' },
  { slug: 'lesson_resource', name: 'Lesson or activity' },
  { slug: 'student_voice', name: 'Student perspective' },
  { slug: 'commentary', name: 'Commentary' },
  { slug: 'news', name: 'News' }
];

export const RELATIONS = [
  { slug: 'companion', name: 'Companion' },
  { slug: 'practical_example', name: 'Practical example' },
  { slug: 'research', name: 'Research' },
  { slug: 'policy_context', name: 'Policy context' },
  { slug: 'newer', name: 'Newer resource' },
  { slug: 'background', name: 'Background' },
  { slug: 'critical_perspective', name: 'Critical perspective' }
];

export const VERIFICATION_STATUSES = ['unverified', 'checked', 'verified'];
export const LINK_STATUSES = ['unchecked', 'ok', 'redirected', 'broken', 'blocked', 'error'];
export const STATUSES = ['indexed', 'published', 'rejected'];

export const collectionSlugs = new Set(COLLECTIONS.map((c) => c.slug));
export const collectionName = (slug) => COLLECTIONS.find((c) => c.slug === slug)?.name ?? slug;
export const evidenceName = (slug) => EVIDENCE_TYPES.find((e) => e.slug === slug)?.name ?? slug;
export const relationName = (slug) => RELATIONS.find((r) => r.slug === slug)?.name ?? slug;

// Perspective groups used by /api/perspectives. Assignment is by editor-set metadata only.
export const PERSPECTIVE_GROUPS = [
  { key: 'guidance', name: 'Guidance and policy', collections: ['policy-governance', 'school-district-leadership'], evidence: ['guidance', 'framework', 'policy_template'] },
  { key: 'research', name: 'Research', collections: ['research-evidence'], evidence: ['research', 'research_summary', 'survey_data'] },
  { key: 'classroom', name: 'Classroom practice', collections: ['inside-classroom', 'elementary-education'], evidence: ['classroom_example', 'lesson_resource'] },
  { key: 'students', name: 'Student perspectives', collections: ['student-perspectives'], evidence: ['student_voice'] },
  { key: 'concerns', name: 'Questions and concerns', collections: ['questions-concerns'], evidence: ['commentary'] }
];

// Learning path stages.
export const PATH_STAGES = [
  { key: 'understand', name: 'Understand', collections: ['start-here', 'ai-literacy', 'learning-thinking'], evidence: ['framework'], formats: ['Glossary'] },
  { key: 'examples', name: 'See examples', collections: ['inside-classroom', 'elementary-education'], evidence: ['classroom_example', 'lesson_resource'], formats: ['Lessons', 'Video', 'Podcast'] },
  { key: 'evidence', name: 'Examine evidence', collections: ['research-evidence'], evidence: ['research', 'research_summary', 'survey_data'], formats: [] },
  { key: 'risks', name: 'Consider risks and questions', collections: ['questions-concerns', 'privacy-security', 'equity-access', 'media-literacy'], evidence: ['commentary'], formats: [] },
  { key: 'act', name: 'Act', collections: ['school-district-leadership', 'policy-governance', 'professional-learning', 'assessment-integrity'], evidence: ['guidance', 'policy_template'], formats: ['Template', 'Checklist', 'Toolkit'] }
];

// Legacy single-value collection names (0001 seed data) mapped to current slugs.
export const LEGACY_COLLECTION_MAP = {
  'Start here': 'start-here',
  'Learning & thinking': 'learning-thinking',
  'Classroom': 'inside-classroom',
  'Families': 'for-families',
  'School decisions': 'school-district-leadership',
  'Questions & risks': 'questions-concerns',
  'Student views': 'student-perspectives',
  'Research': 'research-evidence'
};
