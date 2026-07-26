export type HomepageSeoInput = {
  seoTitle: string
  seoDescription: string
  socialTitle: string
  socialDescription: string
}

export const seoTextLength = (value: string) => [...value].length

export const getHomepageSeoValidationError = (value: HomepageSeoInput) => {
  if (seoTextLength(value.seoTitle.trim()) < 10 || seoTextLength(value.seoTitle.trim()) > 70) {
    return 'Google’i pealkiri peab olema 10–70 tähemärki.'
  }
  if (seoTextLength(value.seoDescription.trim()) < 50 || seoTextLength(value.seoDescription.trim()) > 200) {
    return 'Google’i kirjeldus peab olema 50–200 tähemärki.'
  }
  if (seoTextLength(value.socialTitle.trim()) < 10 || seoTextLength(value.socialTitle.trim()) > 95) {
    return 'Sotsiaalmeedia pealkiri peab olema 10–95 tähemärki.'
  }
  if (seoTextLength(value.socialDescription.trim()) < 20 || seoTextLength(value.socialDescription.trim()) > 200) {
    return 'Sotsiaalmeedia kirjeldus peab olema 20–200 tähemärki.'
  }
  return null
}
