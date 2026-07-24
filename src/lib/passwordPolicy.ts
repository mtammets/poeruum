export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~"
export const PASSWORD_REQUIREMENTS_TEXT = 'Vähemalt 12 märki, sh suur- ja väiketäht, number ning erimärk.'

export const getPasswordPolicyError = (password: string) => {
  if (password.length < PASSWORD_MIN_LENGTH) return `Parool peab olema vähemalt ${PASSWORD_MIN_LENGTH} märki pikk.`
  if (![...password].some((character) => /[a-z]/.test(character))) return 'Parool peab sisaldama vähemalt üht väiketähte.'
  if (![...password].some((character) => /[A-Z]/.test(character))) return 'Parool peab sisaldama vähemalt üht suurtähte.'
  if (![...password].some((character) => /[0-9]/.test(character))) return 'Parool peab sisaldama vähemalt üht numbrit.'
  if (![...password].some((character) => PASSWORD_SYMBOLS.includes(character))) return 'Parool peab sisaldama vähemalt üht erimärki.'
  return null
}
