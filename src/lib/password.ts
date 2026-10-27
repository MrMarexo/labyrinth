/**
 * The shortest password an account may have. The server enforces it
 * (`minPasswordLength` in `~/server/auth`); the forms check it first so a
 * short one is refused in the app's language without a round trip.
 */
export const MIN_PASSWORD_LENGTH = 10;
