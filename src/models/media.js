// Collection is named 'media' instead of 'photos' intentionally.
// When video support is added, video entries are stored here too
// with type: 'video' — no structural changes needed.
const getCollection = (db) => db.collection('media')

module.exports = { getCollection }
