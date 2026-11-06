// ← flow recording (optional): the app's own config, on top of flow recording's defaults.
export default {
  // Name a lane; an unnamed peer shows as its host
  peers: { 'slack.com': 'slack' },

  // Curation. Matchers look at what every OTel span has: name, kind, scope, attributes.
  // Actions: show | hide (with everything under it) | flatten (keep its children).
  hide: [
    // MikroORM checks that the database exists every time it opens a connection
    { attributes: { 'db.query.text': /from pg_database/ } },
  ],
};
