// The privacy notice, shown in a modal from the menu (and at /privacy). Plain text only. Keep it
// accurate: change it whenever what the site collects or sends changes.
export const PRIVACY = {
  title: 'Privacy',
  lede: 'What this site keeps, what it sends to AI services, and how to delete it.',
  warning: 'Do not type student names, student records or other confidential information into this site, including in private notes.',
  sections: [
    { icon: 'userx', title: 'No accounts, no tracking', text: [
      'You can search and browse without signing in, and there are no visitor accounts. The site does not store your searches.',
      'Resources you save and notes you write stay in your browser unless you choose to sync them.'
    ] },
    { icon: 'lock', title: 'Syncing is encrypted', text: [
      'If you sync your saves with a passkey or a private link, your browser encrypts them before they leave it. The site keeps only the encrypted copy, a random identifier and a hash of a check value, so it cannot read what you saved or link it to you. Your passkey never leaves your device or passkey provider.',
      'Anyone with your private link can see and change your saves, so treat it like a password. On the Saved page you can remove your saves from one device or delete the encrypted copy everywhere.'
    ] },
    { icon: 'cpu', title: 'What AI services see', text: [
      'Each search is sent to Cloudflare Workers AI to find matching resources: an embedding model, a small text model that suggests other phrasings, and a reranking model that compares it with the top matches. How a search was read is cached for up to a week, with nothing that identifies you. Saved resources and private notes are never sent.',
      'The short brief on each resource is written once by a Workers AI model from the publisher’s public page and stored. Writing it sends nothing about you.'
    ] },
    { icon: 'server', title: 'Logs', text: [
      'The site does not write search text to its own database. Cloudflare may keep routine request logs under the site owner’s settings.'
    ] }
  ]
};
