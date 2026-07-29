/**
 * The board every account starts with.
 *
 * Somewhere to put things has to exist before the first save, or a new user
 * meets an empty picker at the exact moment they were trying to keep
 * something. It is created at registration rather than on first save so it is
 * already there, visible on the profile, when they go looking.
 *
 * The name depends on what the board is for. A maker's first board holds their
 * own jobs; everybody else's holds work they liked. Calling both "Favourites"
 * would read oddly on an artisan's profile.
 */
export const DEFAULT_BOARD_NAME = Object.freeze({
  maker: 'My work',
  client: 'Favourites',
});

export const defaultBoardName = (role) =>
  role === 'artisan' || role === 'supplier'
    ? DEFAULT_BOARD_NAME.maker
    : DEFAULT_BOARD_NAME.client;
