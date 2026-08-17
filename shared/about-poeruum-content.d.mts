type ContentItem = { title: string; text: string }
type FaqItem = { question: string; answer: string }

export const aboutPoeruumContent: {
  title: string
  seoDescription: string
  definition: string
  workflowHeading: string
  workflowIntro: string
  capabilities: ContentItem[]
  audienceHeading: string
  audienceIntro: string
  audiences: ContentItem[]
  alternativeHeading: string
  alternativeText: string
  stepsHeading: string
  steps: ContentItem[]
  faqHeading: string
  faqs: FaqItem[]
}
