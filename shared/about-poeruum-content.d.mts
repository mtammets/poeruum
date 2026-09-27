type ContentItem = { title: string; text: string }
type FaqItem = { question: string; answer: string }

export const aboutPoeruumContent: {
  title: string
  seoDescription: string
  definition: string
  workflowHeading: string
  workflowIntro: string
  capabilities: (ContentItem & { detail: string })[]
  directoryHeading: string
  directoryText: string
  audienceHeading: string
  audienceIntro: string
  audiences: (ContentItem & { image: string; imageAlt: string; label: string })[]
  alternativeHeading: string
  alternativeText: string
  stepsHeading: string
  stepsIntro: string
  steps: ContentItem[]
  faqHeading: string
  faqs: FaqItem[]
}
