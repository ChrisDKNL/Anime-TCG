import { ANILIST_CHARACTERS_PER_PAGE, ANILIST_SERIES_PER_PAGE } from "./limits.js";

/**
 * The three GraphQL documents the snapshot command sends (collection-packs.md
 * §5.1.5). Fixed text: the only variables are a page number and AniList ids
 * AniList itself returned. Field and argument names confirmed against
 * AniList's schema by introspection on 2026-10-29 (`Media.characters(role,
 * page, perPage)`, `MediaEdge.relationType`, `CharacterEdge.role`).
 */

const RELATIONS = "relations { edges { relationType node { id type } } }";

export const SERIES_QUERY = `query ($page: Int) {
  Page(page: $page, perPage: ${ANILIST_SERIES_PER_PAGE}) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id title { english romaji native } startDate { year } popularity genres ${RELATIONS}
    }
  }
}`;

export const RELATIONS_QUERY = `query ($ids: [Int]) {
  Page(perPage: ${ANILIST_SERIES_PER_PAGE}) {
    media(id_in: $ids, type: ANIME) { id ${RELATIONS} }
  }
}`;

const CHARACTER_FIELDS =
  "pageInfo { hasNextPage } edges { role node { id name { full native } image { large } favourites } }";

export const CHARACTERS_QUERY = `query ($id: Int, $page: Int) {
  Media(id: $id, type: ANIME) {
    main: characters(role: MAIN, page: $page, perPage: ${ANILIST_CHARACTERS_PER_PAGE}) { ${CHARACTER_FIELDS} }
    supporting: characters(role: SUPPORTING, page: $page, perPage: ${ANILIST_CHARACTERS_PER_PAGE}) { ${CHARACTER_FIELDS} }
  }
}`;
