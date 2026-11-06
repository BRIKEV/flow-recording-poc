// Optional: the app's own curation rules, on top of flow recording's defaults.
// Matchers look at what every OTel span has: name, kind, scope, attributes.
// Actions: show | hide (with everything under it) | flatten (keep its children).
export default {
  hide: [
    // MikroORM checks that the database exists every time it opens a connection
    { attributes: { 'db.query.text': /from pg_database/ } },
  ],
};
