// The About note, shown in a modal from the menu. Edit the text below; every string is inserted as
// plain text. Keep it short: who runs it, why it exists and how it works.
export const ABOUT = {
  title: 'About',
  lede: 'A quiet place for Pleasantville UFSD teachers to keep up with AI in the classroom.',
  author: { name: 'Mike Sammartano', role: 'Pleasantville Union Free School District', url: 'https://mikesammartano.com' }, // the name links here
  paragraphs: [
    'AI is changing quickly, and the flood of new articles, tools and advice makes it hard for teachers to know what is worth their time.',
    'This library gathers articles, research, guidance, lessons, courses and tools from a long list of trusted sources into one searchable collection, so you can find something useful for your classroom without wading through all of it.'
  ],
  // How it works, in three short points (icon names from js/icons.js).
  points: [
    { icon: 'refresh', title: 'Gathered from trusted sources', text: 'New items are collected from publishers, researchers and education organizations every few hours.' },
    { icon: 'search', title: 'Searchable with AI', text: 'Search understands plain questions, and each resource opens with a short AI-written brief.' },
    { icon: 'lock', title: 'Nothing about you is kept', text: 'There are no accounts and no tracking. Saved resources stay in your browser unless you turn on encrypted sync.' }
  ],
  // The donate link is off for the district site. Leave href empty to keep it hidden.
  donate: { label: '', href: '', embed: '' },
  // Optional link shown at the end, for example the district site. Leave href empty to hide it.
  link: { label: '', href: '' }
};
